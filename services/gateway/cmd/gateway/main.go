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

	// Per-company trader pool. Each company that an `trades.approved`
	// message arrives for gets its own authorized Deriv WebSocket using
	// that company's token (looked up via deriv.token.req on the api).
	// We never share a connection across companies — that would let
	// company A's trade hit company B's broker account.
	pool := trader.NewPool(
		trader.DefaultPoolConfig(cfg.DerivWSURL, cfg.DerivAppID),
		nc, logger,
	)
	pool.StartBalancePolling(ctx, 5*time.Second)

	orderRouter := trader.NewRouter(pool, nc, logger)
	if err := orderRouter.Start(ctx); err != nil {
		logger.Error("order router failed to start", "err", err)
		// Non-fatal — ticks + fan-out still work without trading.
	}

	// Per-company statement: subject is `deriv.statement.req.<company_id>`.
	// We extract the company_id from the subject tail (NATS guarantees the
	// publisher chose it; we just use the relevant client). Returns the
	// account statement so the dashboard can render transaction history
	// for that company without opening its own authorized Deriv connection.
	if _, err := nc.Subscribe("deriv.statement.req.*", func(m *nats.Msg) {
		var req struct {
			Limit  int `json:"limit"`
			Offset int `json:"offset"`
		}
		_ = json.Unmarshal(m.Data, &req)
		cid := companyFromSubject(m.Subject, "deriv.statement.req.")
		if cid == "" {
			respondErr(m, "company_id missing from subject")
			return
		}
		reqCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
		client, err := pool.Get(reqCtx, cid)
		if err != nil {
			respondErr(m, "trader unavailable: "+err.Error())
			return
		}
		res, err := client.Statement(reqCtx, req.Limit, req.Offset)
		if err != nil {
			respondErr(m, err.Error())
			return
		}
		payload, _ := json.Marshal(res)
		_ = m.Respond(payload)
	}); err != nil {
		logger.Warn("deriv.statement.req.* subscribe failed", "err", err)
	}

	// Per-company manual close: `deriv.sell.req.<company_id>`. Drives the
	// dashboard's "Close" button on an open position. The api side
	// already knows which company the intent belongs to, so it publishes
	// to the right subject; the gateway only needs to use the right
	// client.
	if _, err := nc.Subscribe("deriv.sell.req.*", func(m *nats.Msg) {
		var req struct {
			ContractID int64   `json:"contract_id"`
			Price      float64 `json:"price"`
		}
		_ = json.Unmarshal(m.Data, &req)
		if req.ContractID == 0 {
			respondErr(m, "contract_id required")
			return
		}
		cid := companyFromSubject(m.Subject, "deriv.sell.req.")
		if cid == "" {
			respondErr(m, "company_id missing from subject")
			return
		}
		reqCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
		client, err := pool.Get(reqCtx, cid)
		if err != nil {
			respondErr(m, "trader unavailable: "+err.Error())
			return
		}
		res, err := client.Sell(reqCtx, req.ContractID, req.Price)
		if err != nil {
			logger.Warn("sell failed", "contract_id", req.ContractID, "company", cid, "err", err)
			respondErr(m, err.Error())
			return
		}
		logger.Info("sell ok", "contract_id", res.ContractID, "company", cid, "sold_for", res.SoldFor)
		payload, _ := json.Marshal(res)
		_ = m.Respond(payload)
	}); err != nil {
		logger.Warn("deriv.sell.req.* subscribe failed", "err", err)
	}

	// On-demand warm: `deriv.warm.<company_id>` — fire-and-forget signal
	// from the api telling us this company just configured a token and
	// the dashboard wants its balance ASAP. Without this, balance only
	// appears after the company places its first trade.
	if _, err := nc.Subscribe("deriv.warm.*", func(m *nats.Msg) {
		cid := companyFromSubject(m.Subject, "deriv.warm.")
		if cid == "" {
			return
		}
		warmCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		if _, err := pool.Get(warmCtx, cid); err != nil {
			logger.Warn("warm failed", "company", cid, "err", err)
			return
		}
		logger.Info("client warmed", "company", cid)
	}); err != nil {
		logger.Warn("deriv.warm.* subscribe failed", "err", err)
	}

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

// companyFromSubject extracts the company_id segment from a NATS subject
// like "deriv.sell.req.<uuid>" given the prefix. Returns "" if the
// subject doesn't match the expected shape.
func companyFromSubject(subject, prefix string) string {
	if !strings.HasPrefix(subject, prefix) {
		return ""
	}
	return strings.TrimPrefix(subject, prefix)
}

func respondErr(m *nats.Msg, msg string) {
	payload, _ := json.Marshal(map[string]any{"error": msg})
	_ = m.Respond(payload)
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
