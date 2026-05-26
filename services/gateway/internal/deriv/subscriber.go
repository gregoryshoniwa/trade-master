// Package deriv connects to the Deriv WebSocket API and emits parsed tick events.
//
// Endpoint: wss://ws.derivws.com/websockets/v3?app_id=<APP_ID>
// Docs:     https://developers.deriv.com/docs/
//
// Phase 0: read-only tick subscriptions. Auth, contracts, and order flow come later.
package deriv

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// Config controls the subscriber.
type Config struct {
	WSURL   string   // wss://ws.derivws.com/websockets/v3
	AppID   string   // demo: 1089
	Symbols []string // e.g. ["R_75", "1HZ100V"]
}

// Tick is the normalized inbound tick event we emit downstream.
type Tick struct {
	Symbol    string  `json:"symbol"`
	Quote     float64 `json:"quote"`
	EpochSec  int64   `json:"epoch"`
	Bid       float64 `json:"bid,omitempty"`
	Ask       float64 `json:"ask,omitempty"`
	PipSize   int     `json:"pip_size,omitempty"`
	ID        string  `json:"id,omitempty"`     // Deriv subscription id
	ReceiveTS int64   `json:"recv_ts_ms"`       // gateway ingress (ms epoch)
}

// Subscriber owns one persistent Deriv connection. Ticks are pushed to Out.
type Subscriber struct {
	cfg    Config
	logger *slog.Logger
	Out    chan Tick
}

func NewSubscriber(cfg Config, logger *slog.Logger, bufSize int) *Subscriber {
	if bufSize <= 0 {
		bufSize = 256
	}
	return &Subscriber{
		cfg:    cfg,
		logger: logger,
		Out:    make(chan Tick, bufSize),
	}
}

// Run blocks until ctx is canceled. It maintains the connection with
// exponential backoff on disconnect.
func (s *Subscriber) Run(ctx context.Context) {
	backoff := newBackoff()
	for {
		if ctx.Err() != nil {
			return
		}

		err := s.runOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		wait := backoff.next()
		s.logger.Warn("deriv connection closed; reconnecting",
			"err", err, "backoff", wait.String())

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func (s *Subscriber) runOnce(ctx context.Context) error {
	url := fmt.Sprintf("%s?app_id=%s", s.cfg.WSURL, s.cfg.AppID)
	s.logger.Info("dialing deriv", "url", url)

	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(dialCtx, url, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "client closing")

	conn.SetReadLimit(1 << 20)

	for i, sym := range s.cfg.Symbols {
		sub := map[string]any{
			"ticks":     sym,
			"subscribe": 1,
			"req_id":    1000 + i,
		}
		if err := wsjson.Write(ctx, conn, sub); err != nil {
			return fmt.Errorf("subscribe %s: %w", sym, err)
		}
		s.logger.Info("subscribed to ticks", "symbol", sym, "req_id", sub["req_id"])
	}

	// Keepalive ping every 30s.
	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				pingCtx, c := context.WithTimeout(ctx, 5*time.Second)
				_ = wsjson.Write(pingCtx, conn, map[string]any{"ping": 1, "req_id": 1})
				c()
			}
		}
	}()

	for {
		var msg map[string]json.RawMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			return fmt.Errorf("read: %w", err)
		}

		if rawErr, ok := msg["error"]; ok {
			var e struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			_ = json.Unmarshal(rawErr, &e)
			s.logger.Warn("deriv error", "code", e.Code, "message", e.Message)
			continue
		}

		if rawTick, ok := msg["tick"]; ok {
			s.handleTick(ctx, rawTick)
			continue
		}

		if _, ok := msg["pong"]; ok {
			continue
		}

		if s.logger.Enabled(ctx, slog.LevelDebug) {
			s.logger.Debug("deriv message", "keys", keysOf(msg))
		}
	}
}

func (s *Subscriber) handleTick(ctx context.Context, raw json.RawMessage) {
	var t struct {
		Symbol  string  `json:"symbol"`
		Quote   float64 `json:"quote"`
		Epoch   int64   `json:"epoch"`
		Bid     float64 `json:"bid"`
		Ask     float64 `json:"ask"`
		PipSize int     `json:"pip_size"`
		ID      string  `json:"id"`
	}
	if err := json.Unmarshal(raw, &t); err != nil {
		s.logger.Warn("tick parse error", "err", err)
		return
	}
	tick := Tick{
		Symbol:    t.Symbol,
		Quote:     t.Quote,
		EpochSec:  t.Epoch,
		Bid:       t.Bid,
		Ask:       t.Ask,
		PipSize:   t.PipSize,
		ID:        t.ID,
		ReceiveTS: time.Now().UnixMilli(),
	}

	s.logger.Debug("tick", "symbol", tick.Symbol, "quote", tick.Quote, "epoch", tick.EpochSec)

	// Non-blocking emit. If consumers are slow, drop and warn (don't backpressure Deriv).
	select {
	case s.Out <- tick:
	default:
		s.logger.Warn("tick channel full; dropping", "symbol", tick.Symbol)
	}

	_ = ctx
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

type backoff struct {
	attempt int
	rng     *rand.Rand
}

func newBackoff() *backoff {
	return &backoff{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

func (b *backoff) next() time.Duration {
	b.attempt++
	base := time.Second
	maxWait := 30 * time.Second
	d := base << b.attempt
	if d > maxWait {
		d = maxWait
	}
	jitter := time.Duration(b.rng.Int63n(int64(d / 2)))
	return d/2 + jitter
}
