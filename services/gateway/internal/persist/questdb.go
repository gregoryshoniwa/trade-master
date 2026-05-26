// Package persist writes time-series ticks to QuestDB using Influx Line
// Protocol (ILP) over TCP on port 9009.
//
// ILP format (one line per row):
//   tick,symbol=R_75 quote=29618.4375,bid=29615.4375,ask=29621.4375 1779831984000000000
//                                                                    └── ns since epoch ─┘
//
// QuestDB auto-creates the `tick` table on first write with column types
// inferred from this message. For production we'd use a CREATE TABLE
// migration to pin types explicitly.
package persist

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// Tick mirrors deriv.Tick — we only depend on JSON shape, not the deriv
// package, to keep this loosely coupled.
type Tick struct {
	Symbol    string  `json:"symbol"`
	Quote     float64 `json:"quote"`
	EpochSec  int64   `json:"epoch"`
	Bid       float64 `json:"bid"`
	Ask       float64 `json:"ask"`
	PipSize   int     `json:"pip_size"`
	ReceiveTS int64   `json:"recv_ts_ms"`
}

type Config struct {
	Host          string // questdb
	Port          string // 9009
	FlushEvery    time.Duration
	BatchSize     int
}

func (c Config) addr() string {
	return net.JoinHostPort(c.Host, c.Port)
}

// Writer subscribes to ticks.> on NATS, batches ILP lines, and flushes them
// to QuestDB on a timer or when the batch fills up.
type Writer struct {
	cfg    Config
	logger *slog.Logger
	nc     *nats.Conn

	mu    sync.Mutex
	buf   strings.Builder
	count int

	conn net.Conn
}

func NewWriter(cfg Config, logger *slog.Logger, nc *nats.Conn) *Writer {
	if cfg.FlushEvery == 0 {
		cfg.FlushEvery = 500 * time.Millisecond
	}
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 100
	}
	return &Writer{cfg: cfg, logger: logger, nc: nc}
}

// Start subscribes to NATS and begins the flush loop. Blocks only briefly
// to establish the QuestDB TCP connection.
func (w *Writer) Start(ctx context.Context) error {
	if err := w.dial(); err != nil {
		w.logger.Warn("questdb dial failed; will retry on flush", "err", err)
	}

	sub, err := w.nc.Subscribe("ticks.>", w.handle)
	if err != nil {
		return fmt.Errorf("nats subscribe: %w", err)
	}
	w.logger.Info("questdb writer subscribed", "subject", "ticks.>", "addr", w.cfg.addr())

	ticker := time.NewTicker(w.cfg.FlushEvery)

	go func() {
		defer func() {
			ticker.Stop()
			_ = sub.Unsubscribe()
			_ = w.flush()
			if w.conn != nil {
				_ = w.conn.Close()
			}
		}()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := w.flush(); err != nil {
					w.logger.Warn("questdb flush error", "err", err)
				}
			}
		}
	}()
	return nil
}

func (w *Writer) handle(m *nats.Msg) {
	var t Tick
	if err := json.Unmarshal(m.Data, &t); err != nil {
		w.logger.Warn("questdb tick parse error", "err", err)
		return
	}
	line := formatILP(t)

	w.mu.Lock()
	w.buf.WriteString(line)
	w.count++
	full := w.count >= w.cfg.BatchSize
	w.mu.Unlock()

	if full {
		if err := w.flush(); err != nil {
			w.logger.Warn("questdb flush error", "err", err)
		}
	}
}

func formatILP(t Tick) string {
	// Use receive-ts (ms) as the row timestamp at ns precision. This is
	// more useful than the Deriv epoch (second-resolution) for ordering
	// many ticks within a single second.
	tsNanos := t.ReceiveTS * msToNs
	if tsNanos == 0 {
		tsNanos = time.Now().UnixNano()
	}
	// ILP requires no spaces inside tag values and proper escaping for
	// special chars. Deriv symbols are alphanumeric so we're safe.
	return fmt.Sprintf(
		"tick,symbol=%s quote=%g,bid=%g,ask=%g,pip_size=%di,epoch=%di %d\n",
		t.Symbol, t.Quote, t.Bid, t.Ask, t.PipSize, t.EpochSec, tsNanos,
	)
}

const msToNs = int64(time.Millisecond) // 1_000_000

func (w *Writer) flush() error {
	w.mu.Lock()
	if w.count == 0 {
		w.mu.Unlock()
		return nil
	}
	data := w.buf.String()
	w.buf.Reset()
	cnt := w.count
	w.count = 0
	w.mu.Unlock()

	if w.conn == nil {
		if err := w.dial(); err != nil {
			return fmt.Errorf("redial: %w", err)
		}
	}

	bw := bufio.NewWriter(w.conn)
	if _, err := bw.WriteString(data); err != nil {
		_ = w.conn.Close()
		w.conn = nil
		return err
	}
	if err := bw.Flush(); err != nil {
		_ = w.conn.Close()
		w.conn = nil
		return err
	}
	w.logger.Debug("questdb flush", "rows", cnt, "bytes", len(data))
	return nil
}

func (w *Writer) dial() error {
	conn, err := net.DialTimeout("tcp", w.cfg.addr(), 5*time.Second)
	if err != nil {
		return err
	}
	w.conn = conn
	w.logger.Info("questdb connected", "addr", w.cfg.addr())
	return nil
}
