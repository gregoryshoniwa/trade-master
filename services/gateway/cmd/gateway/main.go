package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/grebles/trade-master/services/gateway/internal/bus"
	"github.com/grebles/trade-master/services/gateway/internal/config"
	"github.com/grebles/trade-master/services/gateway/internal/deriv"
	"github.com/grebles/trade-master/services/gateway/internal/persist"
	"github.com/grebles/trade-master/services/gateway/internal/trader"
	"github.com/grebles/trade-master/services/gateway/internal/ws"
	"github.com/nats-io/nats.go"
)

func main() {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel(),
	}))
	slog.SetDefault(logger)

	logger.Info("gateway starting",
		"deriv_ws_url", cfg.DerivWSURL,
		"deriv_app_id", cfg.DerivAppID,
		"default_symbol", cfg.DefaultSymbol,
		"nats_url", cfg.NATSURL,
		"questdb", cfg.QuestDBILPHost+":"+cfg.QuestDBILPPort,
		"port", cfg.Port,
	)

	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// NATS — internal event bus.
	nc, err := bus.Connect(ctx, cfg.NATSURL, logger)
	if err != nil {
		logger.Error("nats connect failed; exiting", "err", err)
		os.Exit(1)
	}
	defer func() {
		_ = nc.Drain()
	}()

	// QuestDB writer — subscribes to ticks.> and persists ILP rows.
	qdb := persist.NewWriter(persist.Config{
		Host:       cfg.QuestDBILPHost,
		Port:       cfg.QuestDBILPPort,
		FlushEvery: 500 * time.Millisecond,
		BatchSize:  64,
	}, logger, nc)
	if err := qdb.Start(ctx); err != nil {
		logger.Error("questdb writer failed; exiting", "err", err)
		os.Exit(1)
	}

	// WebSocket hub — subscribes to ticks.> and signals.> and fans out to
	// browser clients.
	hub := ws.NewHub(logger, nc)
	if err := hub.Start(ctx); err != nil {
		logger.Error("ws hub failed; exiting", "err", err)
		os.Exit(1)
	}

	// Order router — authorized Deriv connection that executes approved
	// intents. Disabled gracefully if DERIV_API_TOKEN is unset.
	tradeClient := trader.New(trader.Config{
		WSURL:    cfg.DerivWSURL,
		AppID:    cfg.DerivAppID,
		APIToken: cfg.DerivAPIToken,
	}, logger)
	go tradeClient.Run(ctx)
	orderRouter := trader.NewRouter(tradeClient, nc, logger)
	if err := orderRouter.Start(ctx); err != nil {
		logger.Error("order router failed to start", "err", err)
		// Non-fatal — ticks + fan-out still work without trading.
	}

	// NATS request/reply: api sends a `deriv.statement.req` with JSON
	// {"limit":N,"offset":M}; we call Deriv `statement` and reply with the
	// JSON-encoded StatementResult. Lets the dashboard show transaction
	// history without opening its own authorized Deriv connection.
	_, statementSubErr := nc.Subscribe("deriv.statement.req", func(m *nats.Msg) {
		var req struct {
			Limit  int `json:"limit"`
			Offset int `json:"offset"`
		}
		_ = json.Unmarshal(m.Data, &req)
		reqCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
		if !tradeClient.Ready() {
			payload, _ := json.Marshal(map[string]any{"error": "trader not ready"})
			_ = m.Respond(payload)
			return
		}
		res, err := tradeClient.Statement(reqCtx, req.Limit, req.Offset)
		if err != nil {
			payload, _ := json.Marshal(map[string]any{"error": err.Error()})
			_ = m.Respond(payload)
			return
		}
		payload, _ := json.Marshal(res)
		_ = m.Respond(payload)
	})
	if statementSubErr != nil {
		logger.Warn("deriv.statement.req subscribe failed", "err", statementSubErr)
	}

	// Live balance fan-out: poll `balance` every 5s on the authorized
	// session and republish to NATS. We tried a push subscription first,
	// but Deriv's balance push goes silent after a socket reconnect (the
	// new connection has no active subscription and resubscribing
	// requires reconnect-detection plumbing). A one-shot poll every 5s is
	// boring, robust, and a 0.2 RPS load on the broker.
	publishBalance := func(b trader.BalanceUpdate) {
		payload, _ := json.Marshal(b)
		_ = nc.Publish("deriv.balance", payload)
	}
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		// Best-effort first publish from the authorize snapshot so the
		// dashboard isn't empty for the first 5s after boot.
		if snap, ok := tradeClient.LastAuthorize(); ok {
			publishBalance(snap)
		}
		consecutiveFails := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !tradeClient.Ready() {
					continue
				}
				reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
				b, err := tradeClient.GetBalance(reqCtx)
				cancel()
				if err != nil {
					consecutiveFails++
					// Log sparsely so a temporary outage doesn't spam.
					if consecutiveFails == 1 || consecutiveFails%12 == 0 {
						logger.Warn("balance poll failed", "err", err, "consecutive", consecutiveFails)
					}
					continue
				}
				consecutiveFails = 0
				publishBalance(b)
			}
		}
	}()

	// Deriv subscriber — publishes received ticks to NATS.
	symbols := splitCSV(cfg.DefaultSymbol)
	sub := deriv.NewSubscriber(deriv.Config{
		WSURL:   cfg.DerivWSURL,
		AppID:   cfg.DerivAppID,
		Symbols: symbols,
	}, logger, 512)
	go sub.Run(ctx)

	// Publish goroutine: deriv.Tick → NATS ticks.{symbol}
	go func() {
		dropped := 0
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if dropped > 0 {
					logger.Warn("tick publish drops in last 30s", "count", dropped)
					dropped = 0
				}
			case t := <-sub.Out:
				if err := bus.PublishJSON(nc, bus.TickSubject(t.Symbol), t); err != nil {
					dropped++
				}
			}
		}
	}()

	// HTTP server.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.Handle("/ws/ticks", hub.HTTPHandler())

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("http listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server error", "err", err)
			cancel()
		}
	}()

	<-ctx.Done()
	logger.Info("shutdown signal received")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)

	logger.Info("gateway stopped")
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
