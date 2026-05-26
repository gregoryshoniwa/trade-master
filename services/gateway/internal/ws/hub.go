// Package ws fans out tick events to browser WebSocket clients.
//
// Phase 0: every connected client receives every tick on subject ticks.>.
// Phase 1+ will scope per-Company + per-symbol subscriptions.
package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/nats-io/nats.go"
)

// ClientMessage is the envelope we send to browsers.
type ClientMessage struct {
	Type    string          `json:"type"`
	Seq     uint64          `json:"seq"`
	TS      int64           `json:"ts_ms"`
	Payload json.RawMessage `json:"payload"`
}

// Hub holds the set of connected browser clients and subscribes to NATS
// for ticks to broadcast.
type Hub struct {
	logger *slog.Logger
	nc     *nats.Conn
	mu     sync.RWMutex
	conns  map[*client]struct{}
	seq    atomic.Uint64
}

type client struct {
	conn *websocket.Conn
	out  chan ClientMessage
}

func NewHub(logger *slog.Logger, nc *nats.Conn) *Hub {
	return &Hub{
		logger: logger,
		nc:     nc,
		conns:  make(map[*client]struct{}),
	}
}

// Start subscribes to ticks.> on NATS and pumps every received tick to all
// connected browser clients. Returns the NATS subscription so caller can
// unsubscribe on shutdown.
func (h *Hub) Start(ctx context.Context) (*nats.Subscription, error) {
	sub, err := h.nc.Subscribe("ticks.>", func(m *nats.Msg) {
		h.broadcast(ClientMessage{
			Type:    "tick",
			Seq:     h.seq.Add(1),
			TS:      time.Now().UnixMilli(),
			Payload: m.Data,
		})
	})
	if err != nil {
		return nil, err
	}
	h.logger.Info("ws hub subscribed", "subject", "ticks.>")

	go func() {
		<-ctx.Done()
		_ = sub.Unsubscribe()
	}()

	return sub, nil
}

func (h *Hub) broadcast(msg ClientMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.conns {
		select {
		case c.out <- msg:
		default:
			// Slow client. Drop this message; the writer-side timeout
			// will eventually disconnect persistently-slow clients.
		}
	}
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[c] = struct{}{}
	h.logger.Info("ws client connected", "total", len(h.conns))
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.conns[c]; ok {
		delete(h.conns, c)
		close(c.out)
	}
	h.logger.Info("ws client disconnected", "total", len(h.conns))
}

// HTTPHandler upgrades to WebSocket and streams tick messages until the
// client disconnects.
func (h *Hub) HTTPHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true, // Phase 0 dev; locked down in Phase 7
		})
		if err != nil {
			h.logger.Warn("ws upgrade failed", "err", err)
			return
		}

		c := &client{
			conn: conn,
			out:  make(chan ClientMessage, 64),
		}
		h.add(c)

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		// Reader goroutine: detect disconnect.
		go func() {
			defer cancel()
			for {
				if _, _, err := conn.Read(ctx); err != nil {
					return
				}
			}
		}()

		defer func() {
			h.remove(c)
			conn.Close(websocket.StatusNormalClosure, "bye")
		}()

		hello, _ := json.Marshal(map[string]any{
			"server": "trademaster-gateway",
			"phase":  0,
		})
		_ = writeJSON(ctx, conn, ClientMessage{
			Type:    "hello",
			Seq:     0,
			TS:      time.Now().UnixMilli(),
			Payload: hello,
		})

		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-c.out:
				if !ok {
					return
				}
				writeCtx, writeCancel := context.WithTimeout(ctx, 5*time.Second)
				err := writeJSON(writeCtx, conn, msg)
				writeCancel()
				if err != nil {
					h.logger.Warn("ws write failed; closing client", "err", err)
					return
				}
			}
		}
	})
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}
