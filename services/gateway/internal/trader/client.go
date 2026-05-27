// Package trader owns an authorized Deriv connection used to place and
// track real (demo) orders. It is separate from the read-only tick
// connection in internal/deriv — trading needs an authorized session and
// we don't want order traffic competing with the tick fan-out.
package trader

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type Config struct {
	WSURL    string
	AppID    string
	APIToken string
}

// BuyParams is the Deriv contract parameters block for buy-with-parameters.
type BuyParams struct {
	Amount       float64 `json:"amount"`
	Basis        string  `json:"basis"` // "stake"
	ContractType string  `json:"contract_type"`
	Currency     string  `json:"currency"`
	Symbol       string  `json:"symbol"`
	Multiplier   int     `json:"multiplier,omitempty"`
	DurationUnit string  `json:"duration_unit,omitempty"`
	Duration     int     `json:"duration,omitempty"`
	LimitOrder   *Limit  `json:"limit_order,omitempty"`
}

type Limit struct {
	StopLoss   float64 `json:"stop_loss,omitempty"`
	TakeProfit float64 `json:"take_profit,omitempty"`
}

// BuyResult is what we return after a successful buy.
type BuyResult struct {
	ContractID    int64
	BuyPrice      float64
	TransactionID int64
	Longcode      string
}

// ContractUpdate is one proposal_open_contract tick.
type ContractUpdate struct {
	ContractID int64
	IsSold     bool
	Profit     float64
	Status     string // "open" | "won" | "lost" | "sold"
}

// Client maintains one authorized connection with req_id correlation.
type Client struct {
	cfg    Config
	logger *slog.Logger

	mu       sync.Mutex
	conn     *websocket.Conn
	pending  map[int]chan json.RawMessage // one-shot request → response
	subs     map[int]func(json.RawMessage) // persistent subscriptions
	reqIDSeq atomic.Int64
	authed   bool
}

func New(cfg Config, logger *slog.Logger) *Client {
	return &Client{
		cfg:     cfg,
		logger:  logger,
		pending: make(map[int]chan json.RawMessage),
		subs:    make(map[int]func(json.RawMessage)),
	}
}

func (c *Client) nextReqID() int {
	return int(c.reqIDSeq.Add(1))
}

// Run maintains the authorized connection with reconnect. Blocks until
// ctx is canceled.
func (c *Client) Run(ctx context.Context) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		if err := c.connectAndServe(ctx); err != nil && ctx.Err() == nil {
			c.logger.Warn("trader connection closed; reconnecting",
				"err", err, "backoff", backoff.String())
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}
}

func (c *Client) connectAndServe(ctx context.Context) error {
	if c.cfg.APIToken == "" {
		// No token → trading disabled. Sleep until canceled so we don't
		// hot-loop. The order router checks Ready() before submitting.
		c.logger.Warn("trader: DERIV_API_TOKEN not set; order placement disabled")
		<-ctx.Done()
		return ctx.Err()
	}

	url := fmt.Sprintf("%s?app_id=%s", c.cfg.WSURL, c.cfg.AppID)
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(dialCtx, url, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	conn.SetReadLimit(1 << 20)
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	c.mu.Lock()
	c.conn = conn
	c.authed = false
	c.mu.Unlock()

	// Authorize first.
	authReqID := c.nextReqID()
	authCh := c.register(authReqID)
	if err := wsjson.Write(ctx, conn, map[string]any{
		"authorize": c.cfg.APIToken,
		"req_id":    authReqID,
	}); err != nil {
		return fmt.Errorf("send authorize: %w", err)
	}

	// Reader loop.
	readErr := make(chan error, 1)
	go func() {
		for {
			var raw json.RawMessage
			if err := wsjson.Read(ctx, conn, &raw); err != nil {
				readErr <- err
				return
			}
			c.dispatch(raw)
		}
	}()

	// Wait for authorize result.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case raw := <-authCh:
		var resp struct {
			Error *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
			Authorize *struct {
				Loginid  string `json:"loginid"`
				Currency string `json:"currency"`
				Balance  float64 `json:"balance"`
				IsVirtual int    `json:"is_virtual"`
			} `json:"authorize"`
		}
		_ = json.Unmarshal(raw, &resp)
		if resp.Error != nil {
			return fmt.Errorf("authorize failed: %s %s", resp.Error.Code, resp.Error.Message)
		}
		c.mu.Lock()
		c.authed = true
		c.mu.Unlock()
		if resp.Authorize != nil {
			c.logger.Info("trader authorized",
				"loginid", resp.Authorize.Loginid,
				"currency", resp.Authorize.Currency,
				"balance", resp.Authorize.Balance,
				"is_virtual", resp.Authorize.IsVirtual)
		}
	case <-time.After(15 * time.Second):
		return fmt.Errorf("authorize timeout")
	}

	// Keepalive ping.
	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				pc, pcancel := context.WithTimeout(ctx, 5*time.Second)
				_ = c.send(pc, map[string]any{"ping": 1})
				pcancel()
			}
		}
	}()

	// Block until the reader errors or ctx cancels.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-readErr:
		c.failPending(err)
		return err
	}
}

func (c *Client) Ready() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.authed && c.conn != nil
}

func (c *Client) register(reqID int) chan json.RawMessage {
	ch := make(chan json.RawMessage, 1)
	c.mu.Lock()
	c.pending[reqID] = ch
	c.mu.Unlock()
	return ch
}

func (c *Client) dispatch(raw json.RawMessage) {
	var head struct {
		ReqID int `json:"req_id"`
	}
	_ = json.Unmarshal(raw, &head)

	c.mu.Lock()
	if ch, ok := c.pending[head.ReqID]; ok {
		delete(c.pending, head.ReqID)
		c.mu.Unlock()
		ch <- raw
		return
	}
	if handler, ok := c.subs[head.ReqID]; ok {
		c.mu.Unlock()
		handler(raw)
		return
	}
	c.mu.Unlock()
}

func (c *Client) failPending(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.subs = make(map[int]func(json.RawMessage))
}

func (c *Client) send(ctx context.Context, msg map[string]any) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("no connection")
	}
	return wsjson.Write(ctx, conn, msg)
}

// Buy submits a buy-with-parameters request and waits for the result.
func (c *Client) Buy(ctx context.Context, params BuyParams, maxPrice float64) (*BuyResult, error) {
	if !c.Ready() {
		return nil, fmt.Errorf("trader not ready (not authorized)")
	}
	reqID := c.nextReqID()
	ch := c.register(reqID)

	if err := c.send(ctx, map[string]any{
		"buy":        1,
		"price":      maxPrice,
		"parameters": params,
		"req_id":     reqID,
	}); err != nil {
		return nil, fmt.Errorf("send buy: %w", err)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case raw, ok := <-ch:
		if !ok {
			return nil, fmt.Errorf("connection lost during buy")
		}
		var resp struct {
			Error *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
			Buy *struct {
				ContractID    int64   `json:"contract_id"`
				BuyPrice      float64 `json:"buy_price"`
				TransactionID int64   `json:"transaction_id"`
				Longcode      string  `json:"longcode"`
			} `json:"buy"`
		}
		if err := json.Unmarshal(raw, &resp); err != nil {
			return nil, fmt.Errorf("parse buy resp: %w", err)
		}
		if resp.Error != nil {
			return nil, fmt.Errorf("deriv: %s — %s", resp.Error.Code, resp.Error.Message)
		}
		if resp.Buy == nil {
			return nil, fmt.Errorf("deriv: empty buy response")
		}
		return &BuyResult{
			ContractID:    resp.Buy.ContractID,
			BuyPrice:      resp.Buy.BuyPrice,
			TransactionID: resp.Buy.TransactionID,
			Longcode:      resp.Buy.Longcode,
		}, nil
	case <-time.After(20 * time.Second):
		return nil, fmt.Errorf("buy timeout")
	}
}

// TrackContract subscribes to proposal_open_contract and invokes onUpdate
// for each tick until the contract is sold or ctx is canceled. The
// subscription is unregistered automatically on sale.
func (c *Client) TrackContract(ctx context.Context, contractID int64, onUpdate func(ContractUpdate)) error {
	if !c.Ready() {
		return fmt.Errorf("trader not ready")
	}
	reqID := c.nextReqID()

	done := make(chan struct{})
	c.mu.Lock()
	c.subs[reqID] = func(raw json.RawMessage) {
		var resp struct {
			ProposalOpenContract *struct {
				ContractID int64   `json:"contract_id"`
				IsSold     int     `json:"is_sold"`
				Profit     float64 `json:"profit"`
				Status     string  `json:"status"`
			} `json:"proposal_open_contract"`
		}
		if err := json.Unmarshal(raw, &resp); err != nil || resp.ProposalOpenContract == nil {
			return
		}
		poc := resp.ProposalOpenContract
		upd := ContractUpdate{
			ContractID: poc.ContractID,
			IsSold:     poc.IsSold == 1,
			Profit:     poc.Profit,
			Status:     poc.Status,
		}
		onUpdate(upd)
		if upd.IsSold {
			c.mu.Lock()
			delete(c.subs, reqID)
			c.mu.Unlock()
			select {
			case <-done:
			default:
				close(done)
			}
		}
	}
	c.mu.Unlock()

	if err := c.send(ctx, map[string]any{
		"proposal_open_contract": 1,
		"contract_id":            contractID,
		"subscribe":              1,
		"req_id":                 reqID,
	}); err != nil {
		c.mu.Lock()
		delete(c.subs, reqID)
		c.mu.Unlock()
		return fmt.Errorf("subscribe open contract: %w", err)
	}
	return nil
}
