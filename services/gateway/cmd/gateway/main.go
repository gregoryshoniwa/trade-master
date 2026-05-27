package main

import (
	"context"
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
	"github.com/grebles/trade-master/services/gateway/internal/ws"
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
