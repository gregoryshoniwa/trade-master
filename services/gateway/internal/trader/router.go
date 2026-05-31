package trader

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"time"

	"github.com/nats-io/nats.go"
)

// round2 clamps a money amount to 2 decimal places. Deriv rejects buys
// whose amount/price carry more precision than the account currency.
func round2(x float64) float64 {
	return math.Round(x*100) / 100
}

// ApprovedIntent is the subset of a TradeIntent the api publishes to
// trades.approved.{company} once it's cleared for execution.
type ApprovedIntent struct {
	IntentID         string  `json:"intent_id"`
	ClientUUID       string  `json:"client_uuid"`
	CompanyID        string  `json:"company_id"`
	AgentID          string  `json:"agent_id"`
	Asset            string  `json:"asset"`
	ContractType     string  `json:"contract_type"`
	StakeUSD         float64 `json:"stake_usd"`
	Multiplier       int     `json:"multiplier"`
	DurationSecs     int     `json:"duration_secs"`
	StopLossAmount   float64 `json:"stop_loss_amount"`
	TakeProfitAmount float64 `json:"take_profit_amount"`
	Currency         string  `json:"currency"`
}

// ExecutedEvent → trades.executed
type ExecutedEvent struct {
	IntentID      string  `json:"intent_id"`
	ClientUUID    string  `json:"client_uuid"`
	CompanyID     string  `json:"company_id"`
	OK            bool    `json:"ok"`
	ContractID    int64   `json:"contract_id,omitempty"`
	BuyPrice      float64 `json:"buy_price,omitempty"`
	TransactionID int64   `json:"transaction_id,omitempty"`
	Longcode      string  `json:"longcode,omitempty"`
	Error         string  `json:"error,omitempty"`
}

// ClosedEvent → trades.closed
type ClosedEvent struct {
	IntentID    string  `json:"intent_id"`
	CompanyID   string  `json:"company_id"`
	ContractID  int64   `json:"contract_id"`
	RealizedPnL float64 `json:"realized_pnl_usd"`
	ExitReason  string  `json:"exit_reason"`
	Status      string  `json:"status"`
}

// Router consumes trades.approved.> and drives a per-company trader.
//
// The pool owns the one-Client-per-company lifecycle; the router only
// asks for the right client given the intent's company_id and forwards
// the buy. This means a customer trading via their own Deriv token can
// only ever submit orders to their own account.
type Router struct {
	pool   *Pool
	nc     *nats.Conn
	logger *slog.Logger
}

func NewRouter(pool *Pool, nc *nats.Conn, logger *slog.Logger) *Router {
	return &Router{pool: pool, nc: nc, logger: logger}
}

func (r *Router) Start(ctx context.Context) error {
	sub, err := r.nc.Subscribe("trades.approved.>", func(m *nats.Msg) {
		go r.handleApproved(ctx, m.Data)
	})
	if err != nil {
		return err
	}
	r.logger.Info("order router subscribed", "subject", "trades.approved.>")
	go func() {
		<-ctx.Done()
		_ = sub.Unsubscribe()
	}()
	return nil
}

func (r *Router) handleApproved(ctx context.Context, data []byte) {
	var intent ApprovedIntent
	if err := json.Unmarshal(data, &intent); err != nil {
		r.logger.Warn("order router: bad approved intent", "err", err)
		return
	}

	currency := intent.Currency
	if currency == "" {
		currency = "USD"
	}

	stake := round2(intent.StakeUSD)
	params := BuyParams{
		Amount:       stake,
		Basis:        "stake",
		ContractType: intent.ContractType,
		Currency:     currency,
		Symbol:       intent.Asset,
	}
	// Multipliers carry a `multiplier` + broker-side limit_order for the
	// stop/target. Everything else — Rise/Fall CALL/PUT, plus any future
	// CALLE/PUTE/Touch/NoTouch — uses a tick or second duration and no
	// limit_order. The `default:` branch covers them all because the api
	// already populates DurationSecs via the contract registry's plugin
	// (`app/contracts/__init__.py`).
	switch intent.ContractType {
	case "MULTUP", "MULTDOWN":
		params.Multiplier = intent.Multiplier
		if intent.StopLossAmount > 0 || intent.TakeProfitAmount > 0 {
			params.LimitOrder = &Limit{
				StopLoss:   round2(intent.StopLossAmount),
				TakeProfit: round2(intent.TakeProfitAmount),
			}
		}
	default:
		params.DurationUnit = "s"
		params.Duration = intent.DurationSecs
	}

	buyCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	client, err := r.pool.Get(buyCtx, intent.CompanyID)
	if err != nil {
		r.logger.Warn("no trader for company", "company", intent.CompanyID, "intent", intent.IntentID, "err", err)
		r.publishExecuted(ExecutedEvent{
			IntentID:   intent.IntentID,
			ClientUUID: intent.ClientUUID,
			CompanyID:  intent.CompanyID,
			OK:         false,
			Error:      "trader unavailable: " + err.Error(),
		})
		return
	}

	if pj, jerr := json.Marshal(params); jerr == nil {
		r.logger.Info("submitting buy", "intent", intent.IntentID, "company", intent.CompanyID, "params", string(pj))
	}

	// For stake basis, max price = stake (we never pay more than we stake).
	res, err := client.Buy(buyCtx, params, stake)
	if err != nil {
		r.logger.Warn("buy failed", "intent", intent.IntentID, "asset", intent.Asset, "err", err)
		r.publishExecuted(ExecutedEvent{
			IntentID:   intent.IntentID,
			ClientUUID: intent.ClientUUID,
			CompanyID:  intent.CompanyID,
			OK:         false,
			Error:      err.Error(),
		})
		return
	}

	r.logger.Info("contract opened",
		"intent", intent.IntentID, "asset", intent.Asset,
		"contract_id", res.ContractID, "buy_price", res.BuyPrice)
	r.publishExecuted(ExecutedEvent{
		IntentID:      intent.IntentID,
		ClientUUID:    intent.ClientUUID,
		CompanyID:     intent.CompanyID,
		OK:            true,
		ContractID:    res.ContractID,
		BuyPrice:      res.BuyPrice,
		TransactionID: res.TransactionID,
		Longcode:      res.Longcode,
	})

	// Track to settlement. Use a fresh long-lived context (not the buy
	// timeout) — multipliers can stay open indefinitely.
	intentID := intent.IntentID
	companyID := intent.CompanyID
	_ = client.TrackContract(ctx, res.ContractID, func(u ContractUpdate) {
		if !u.IsSold {
			return
		}
		// Deriv's final status is sometimes empty; infer from P&L sign when
		// it is, so the postmortem gets a meaningful exit reason.
		exitReason := "sold"
		switch {
		case u.Status == "won":
			exitReason = "take_profit"
		case u.Status == "lost":
			exitReason = "stop_loss"
		case u.Profit > 0:
			exitReason = "take_profit"
		case u.Profit < 0:
			exitReason = "stop_loss"
		}
		r.publishClosed(ClosedEvent{
			IntentID:    intentID,
			CompanyID:   companyID,
			ContractID:  u.ContractID,
			RealizedPnL: u.Profit,
			ExitReason:  exitReason,
			Status:      u.Status,
		})
		r.logger.Info("contract settled",
			"intent", intentID, "contract_id", u.ContractID,
			"pnl", u.Profit, "status", u.Status)
	})
}

func (r *Router) publishExecuted(ev ExecutedEvent) {
	data, _ := json.Marshal(ev)
	_ = r.nc.Publish("trades.executed."+ev.CompanyID, data)
}

func (r *Router) publishClosed(ev ClosedEvent) {
	data, _ := json.Marshal(ev)
	_ = r.nc.Publish("trades.closed."+ev.CompanyID, data)
}
