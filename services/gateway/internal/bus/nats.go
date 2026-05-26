// Package bus wraps the NATS client we use as the internal event bus.
//
// Subject design (PLAN §19.1):
//   ticks.{symbol}      ephemeral tick stream
//   candles.{symbol}    candle stream (future)
//   trades.intent...    trade lifecycle (future, JetStream)
//   audit.>             durable audit (future, JetStream)
package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"
)

const SubjectTickPrefix = "ticks."

// Connect dials NATS with sensible reconnect defaults.
func Connect(ctx context.Context, url string, logger *slog.Logger) (*nats.Conn, error) {
	opts := []nats.Option{
		nats.Name("trademaster-gateway"),
		nats.ReconnectWait(2 * time.Second),
		nats.MaxReconnects(-1), // forever
		nats.PingInterval(20 * time.Second),
		nats.MaxPingsOutstanding(3),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			logger.Warn("nats disconnected", "err", err)
		}),
		nats.ReconnectHandler(func(c *nats.Conn) {
			logger.Info("nats reconnected", "url", c.ConnectedUrl())
		}),
		nats.ClosedHandler(func(_ *nats.Conn) {
			logger.Warn("nats connection closed")
		}),
	}

	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	type result struct {
		nc  *nats.Conn
		err error
	}
	ch := make(chan result, 1)
	go func() {
		nc, err := nats.Connect(url, opts...)
		ch <- result{nc, err}
	}()
	select {
	case <-dialCtx.Done():
		return nil, fmt.Errorf("nats dial timeout: %w", dialCtx.Err())
	case r := <-ch:
		if r.err != nil {
			return nil, fmt.Errorf("nats dial: %w", r.err)
		}
		logger.Info("nats connected", "url", r.nc.ConnectedUrl())
		return r.nc, nil
	}
}

// PublishJSON marshals v as JSON and publishes to subj. Non-blocking;
// returns the marshal/publish error if any.
func PublishJSON(nc *nats.Conn, subj string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if err := nc.Publish(subj, data); err != nil {
		return fmt.Errorf("publish %s: %w", subj, err)
	}
	return nil
}

// TickSubject returns the canonical subject for a symbol's tick stream.
func TickSubject(symbol string) string {
	return SubjectTickPrefix + symbol
}
