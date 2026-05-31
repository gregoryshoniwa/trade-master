package trader

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// Pool keeps one authorized Deriv Client per company. The first time a
// company shows up (a trade, a statement request, or a sell), we ask the
// api over NATS for its token, then dial Deriv and start streaming.
//
// We intentionally never share a Client across companies: each company's
// trades must hit *their* broker account, and balance pushes must go to
// the right subscriber. A single shared connection would mix them up.
//
// Lifecycle: clients live as long as the gateway. We don't evict idle
// clients yet — paying customers stay active, and a typical install will
// have a small number of companies. If that changes we can add an LRU
// eviction with a cancel-the-Run-goroutine close path.
type Pool struct {
	cfg    PoolConfig
	nc     *nats.Conn
	logger *slog.Logger

	mu      sync.Mutex
	clients map[string]*pooledClient // keyed by company UUID
}

type PoolConfig struct {
	WSURL string
	AppID string
	// TokenRequestTimeout — how long to wait for the api to reply with a
	// token. Short, because the api just does a single PG read.
	TokenRequestTimeout time.Duration
	// AuthorizeTimeout — how long to wait for the new Client to reach
	// Ready() after we hand it the token. Deriv authorize is usually <1s
	// but the WS dial can be slow.
	AuthorizeTimeout time.Duration
}

func DefaultPoolConfig(wsURL, appID string) PoolConfig {
	return PoolConfig{
		WSURL:               wsURL,
		AppID:               appID,
		TokenRequestTimeout: 5 * time.Second,
		AuthorizeTimeout:    15 * time.Second,
	}
}

type pooledClient struct {
	client *Client
	cancel context.CancelFunc
	env    string // "demo" | "real" — for logging / future demo gating
}

func NewPool(cfg PoolConfig, nc *nats.Conn, logger *slog.Logger) *Pool {
	return &Pool{
		cfg:     cfg,
		nc:      nc,
		logger:  logger.With("component", "trader_pool"),
		clients: make(map[string]*pooledClient),
	}
}

// Get returns a ready (authorized) Client for the given company.
// Creates one on first call. Returns an error if the company has no
// token configured, or authorize failed.
func (p *Pool) Get(ctx context.Context, companyID string) (*Client, error) {
	if companyID == "" {
		return nil, fmt.Errorf("companyID required")
	}

	p.mu.Lock()
	pc, ok := p.clients[companyID]
	p.mu.Unlock()
	if ok {
		if pc.client.Ready() {
			return pc.client, nil
		}
		// Client exists but isn't authorized (still dialing or in reconnect
		// backoff). Wait briefly.
		if err := waitReady(ctx, pc.client, p.cfg.AuthorizeTimeout); err != nil {
			return nil, fmt.Errorf("client not ready: %w", err)
		}
		return pc.client, nil
	}

	// First touch — fetch token, spin up client.
	token, env, err := p.lookupToken(ctx, companyID)
	if err != nil {
		return nil, fmt.Errorf("lookup token: %w", err)
	}
	if token == "" {
		return nil, fmt.Errorf("no deriv token configured for company %s", companyID)
	}

	p.mu.Lock()
	// Re-check under lock (two callers can race in).
	if existing, ok := p.clients[companyID]; ok {
		p.mu.Unlock()
		return existing.client, nil
	}
	clientCtx, cancel := context.WithCancel(context.Background())
	c := New(Config{WSURL: p.cfg.WSURL, AppID: p.cfg.AppID, APIToken: token}, p.logger.With("company", companyID, "env", env))
	p.clients[companyID] = &pooledClient{client: c, cancel: cancel, env: env}
	p.mu.Unlock()

	go c.Run(clientCtx)

	if err := waitReady(ctx, c, p.cfg.AuthorizeTimeout); err != nil {
		// Authorize failed — yank the entry so a subsequent call retries
		// (with possibly a refreshed token).
		p.mu.Lock()
		delete(p.clients, companyID)
		p.mu.Unlock()
		cancel()
		return nil, fmt.Errorf("authorize: %w", err)
	}
	p.logger.Info("client ready", "company", companyID, "env", env)
	return c, nil
}

// StartBalancePolling pushes a balance update for every known client
// every interval, on `deriv.balance.{company_id}`. We don't subscribe
// to Deriv's balance push because it goes silent across socket
// reconnects; polling is boring and robust.
func (p *Pool) StartBalancePolling(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				p.pollAndPublishAll(ctx)
			}
		}
	}()
}

func (p *Pool) pollAndPublishAll(ctx context.Context) {
	p.mu.Lock()
	snapshot := make(map[string]*pooledClient, len(p.clients))
	for cid, pc := range p.clients {
		snapshot[cid] = pc
	}
	p.mu.Unlock()
	for cid, pc := range snapshot {
		if !pc.client.Ready() {
			continue
		}
		reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		b, err := pc.client.GetBalance(reqCtx)
		cancel()
		if err != nil {
			// Sparse logging: one log line per company per failure.
			p.logger.Warn("balance poll failed", "company", cid, "err", err)
			continue
		}
		payload, _ := json.Marshal(b)
		_ = p.nc.Publish("deriv.balance."+cid, payload)
	}
}

// lookupToken RPCs the api for a company's Deriv token.
func (p *Pool) lookupToken(ctx context.Context, companyID string) (string, string, error) {
	req, _ := json.Marshal(map[string]string{"company_id": companyID})
	timeoutCtx, cancel := context.WithTimeout(ctx, p.cfg.TokenRequestTimeout)
	defer cancel()
	msg, err := p.nc.RequestWithContext(timeoutCtx, "deriv.token.req", req)
	if err != nil {
		return "", "", fmt.Errorf("nats: %w", err)
	}
	var body struct {
		Token       *string `json:"token"`
		Environment string  `json:"environment"`
		Error       string  `json:"error"`
	}
	if err := json.Unmarshal(msg.Data, &body); err != nil {
		return "", "", fmt.Errorf("decode token resp: %w", err)
	}
	if body.Error != "" {
		return "", "", fmt.Errorf("api: %s", body.Error)
	}
	tok := ""
	if body.Token != nil {
		tok = *body.Token
	}
	return tok, body.Environment, nil
}

// waitReady polls c.Ready() with a tight backoff until ready or timeout.
// We can't use c.Run's signaling because the Client doesn't expose one;
// polling is fine since this only runs at Pool.Get cold-start.
func waitReady(ctx context.Context, c *Client, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if c.Ready() {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for Ready()")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
