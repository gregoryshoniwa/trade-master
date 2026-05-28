# TradeMaster

AI-orchestrated multi-model trading platform on Deriv. Multi-tenant SaaS,
launching in Zimbabwe. **Phase 0–4 mostly shipped; running live A/B on the
Deriv demo account today.**

See [PLAN.md](PLAN.md) for the full architecture spec and current
phase-by-phase status. AI session notes live in [AGENTS.md](AGENTS.md).

---

## Quick start

Requires Docker Desktop (the stack runs CPU TSFMs on an M1 MacBook Air with
8 GB just fine). For native Go / Node dev, you need Go 1.22+ and Node 22+.

```bash
cp .env.example .env       # fill in DERIV_API_TOKEN + your LLM API keys
make dev                   # bring the full stack up (postgres + 8 services)
make logs                  # tail everything
make migrate               # apply pending DB migrations
make down                  # stop
make clean                 # stop + wipe volumes (destroys local data)
```

Then open <http://localhost:3000> — you'll land on the live dashboard.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  Browser                                                              │
│   ├── Next.js 15 web at :3000  ──┐                                    │
│   │   (live dashboard, agents,    │                                   │
│   │    approvals, postmortems,    │ REST + WS                          │
│   │    calendar, attribution)     │                                   │
└────────────────────────────────────┼──────────────────────────────────┘
                                     ▼
┌────────────────────────┐  ┌─────────────────────────┐  ┌──────────────┐
│  api (FastAPI)         │  │  gateway (Go)           │  │  ttm (Py)    │
│  :8000                 │  │  :18080                 │  │  :18081      │
│  · auth + multi-tenant │  │  · Deriv WSS authorized │  │  Granite     │
│  · agent CRUD          │  │  · ticks fan-out via    │  │  TimeSeries  │
│  · decision loop       │  │    NATS                 │  │  TTM r2      │
│  · strategy gate       │  │  · QuestDB tick persist │  │              │
│  · risk + kill switch  │  │  · browser WS hub       │  │              │
│  · postmortems         │  │  · order router         │  ├──────────────┤
│  · calendar ingestor   │  │    (buy multipliers,    │  │  kronos (Py) │
│  · safety cron         │  │     track to settle)    │  │  :18082      │
│  · attribution         │  │                         │  │  Kronos-small│
└──────┬──────────┬──────┘  └──────────┬──────────────┘  │  (OHLCV)     │
       │          │                    │                 └──────────────┘
       ▼          ▼                    ▼                        │
┌──────────┐ ┌────────────┐  ┌─────────────────────────┐         │
│ postgres │ │ NATS JS    │◀─┤  ticks.{symbol}         │◀────────┘
│ +pgvector│ │ pub/sub    │  │  signals.{model}.{sym}  │
│ schema   │ │            │  │  trades.approved/exec/  │
└──────────┘ └────────────┘  │         closed.{co}     │
                             └─────────────────────────┘
                                          │
                                          ▼
                              ┌──────────────────────┐
                              │ QuestDB (tick TS DB) │
                              └──────────────────────┘
```

**Data flow per trade:**
1. **gateway** receives Deriv ticks → fans out to NATS `ticks.{symbol}`
   + persists to QuestDB.
2. **ttm** / **kronos** subscribe to ticks, run forecasts, publish
   `signals.{model}.{symbol}` envelopes.
3. **api.decision_loop** consumes signals, matches against active agents
   (per their `forecasting_model`), pulls recent OHLC from QuestDB,
   runs each agent's **strategy modules** (EMA/ATR/RSI/ADX/BB rules),
   computes Kelly stake, runs the **Risk Agent** (kill switch, asset/
   contract tier, event blackout, confidence floor, etc.), and inserts
   a `trade_intent`.
4. Autonomous intents publish to `trades.approved.{company}`; the
   gateway's **order router** authorizes against Deriv and submits the
   buy with broker-enforced stop/target.
5. The gateway tracks each contract via `proposal_open_contract` and
   publishes `trades.closed.{company}` on settle.
6. **api.execution** consumes close events, updates the intent, and
   spawns **postmortem.generate** which builds a structured trace + an
   LLM narrative.

---

## Host port map

Host ports are deliberately non-default so they don't clash with other
local apps. Inside the container network, services talk to each other on
default ports via service names.

| Service | Host port | Container port |
|---|---|---|
| Web (Next.js) | 3000 | 3000 |
| API (FastAPI) | 8000 | 8000 |
| Gateway (Go) | **18080** | 8080 |
| TTM forecaster | **18081** | 8081 |
| Kronos forecaster | **18082** | 8082 |
| Postgres + pgvector | 5432 | 5432 |
| Redis | 6379 | 6379 |
| NATS (client / monitor) | 4222 / 8222 | 4222 / 8222 |
| QuestDB (HTTP / ILP / PG) | 9000 / 9009 / 8812 | 9000 / 9009 / 8812 |

Browser hits `NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws/ticks` for the
live tick + forecast stream.

---

## What works today

- **Multi-tenant SaaS**: companies, members (owner/admin/trader/viewer),
  password auth + signup + invites, per-company brand color.
- **Agent CRUD** with 5 personality presets (Sniper/Scalper/Hunter/
  Guardian/Balanced/Custom), per-agent **LLM picker** and **forecasting-
  model picker**, allocation, Kelly fraction, max position, max trades/day,
  drawdown caps.
- **Multi-model forecasting**: TTM (granite-r2) + Kronos-small running
  side-by-side; each agent picks which model drives it. Routing is
  per-signal — agents only see signals from their configured model.
- **Decision pipeline**: signal → **strategy gate** (5 PLAN-§4 modules:
  trend, breakout, S/R, mean-rev, price-action; real EMA/ATR/RSI/ADX/BB)
  → **selection-mode gate** (specific / most-profitable / safest /
  balanced) → **Kelly sizing** → **Risk Agent** (11 checks incl. kill
  switch + economic-calendar blackout + post-event sizing) → trade intent.
- **Approval queue** (`/approvals`) with countdown, full risk verdict
  breakdown, one-click approve/reject.
- **Postmortems** (`/postmortems`) — auto-generated per settled trade:
  structured entry trace + exit trace + per-employee rating + Gemini
  narrative. Logged with full LLM cost attribution.
- **Attribution dashboard** (`/attribution`) — per-agent, per-model,
  per-asset P&L roll-ups over today / 7d / 30d / all-time.
- **Economic calendar** (`/calendar`) — Forex Factory weekly JSON
  ingested every 4h, used by the risk agent to blackout high-impact
  windows and halve sizing for 2h post-event.
- **Safety net** — operator **kill switch** on the dashboard (audited,
  with reason), **circuit breaker** that auto-trips on a configurable
  daily-loss limit, **auto-pause cron** for agents past their drawdown
  limit over rolling 24h.
- **Cost tracking** (`/payroll`) — every LLM call recorded; per-agent
  monthly projection split into "freelancers" (cloud) and "employees"
  (self-hosted / vLLM).
- **Live dashboard** (`/`) — real-time line/candle chart (toggle), trade
  markers + stop/target lines per open position, agent-grouped right
  rail with live unrealized P&L, click any position to focus the chart.
- **Theming** — dark default + light mode toggle, conventional trading
  palette (TradingView-style accent + classic green/red).
- **Walk-forward backtest harness** — `docker compose run --rm ttm
  python -m app.backtest` — proved TTM has no stable directional edge
  on 60s candles (overall 51–55% hit-rate, unstable across timeframes).

---

## What's next (deferred roadmap)

In rough priority order — none of these block running the platform today,
but each unlocks meaningful capability:

1. **LangGraph LLM decision brain** — replace the mechanical decision
   loop with a Manager Agent that synthesizes employee StrategySignals +
   calendar context via Gemini/Claude into a reasoned go/no-go. The
   single biggest pending architectural piece.
2. **Chronos-Bolt-small + TimesFM 2.5 + Kronos-base** — three more
   forecasting services to enable a real ensemble. Pattern is now well-
   established (mirror `services/models/kronos`).
3. **Voice via Gemini Live** — per-agent voice config, voice modal,
   transcript audit. PLAN §12.
4. **Sentiment ingestion** — Polymarket / Kalshi / Manifold / Finnhub
   news. PLAN §5 / §15.
5. **WebAuthn live-trade unlock** + **14-day paper gate** — required
   before any real-money path. PLAN §22 / §27.
6. **Backtest UI** — promote `app.backtest` to a web view so non-CLI
   operators can evaluate models per instrument.
7. **Conformal calibration** on TSFM outputs — replace heuristic
   confidence with statistically-grounded coverage intervals.
8. **Stripe + crypto-pay** + **ZW Shona translations** + **Lite mode** —
   real onboarding.
9. **Mobile** (PWA install + React Native).
10. **Cloud GPU tier** (Chronos-2 + FinCast 1B) — opt-in for heavier
    models.

---

## Honest signal-quality status

The walk-forward backtest harness (run via `docker compose run --rm ttm
python -m app.backtest`) proved that **TTM alone has no robust
directional edge** on real markets — overall hit-rate 51–55%, with the
confidence-vs-accuracy relationship unstable across timeframes (good on
60s, inverted on 300s). Kronos-small is in live A/B but hasn't been
backtested yet. Synthetic indices (R_75, 1HZ100V) are RNG random walks
and permanently off the live-trade list. **Don't scale up real-money
trading until a stable edge is demonstrated across multiple windows and
includes realistic spread/fees.** See `memory/ttm-no-stable-edge.md`.

---

## Repository layout

```
trade-master/
├── PLAN.md                              · full architecture spec
├── README.md                            · this file
├── AGENTS.md                            · session notes for AI sessions
├── Makefile                             · dev / up / down / logs / migrate
├── docker-compose.yml                   · 8-service compose stack
├── migrations/                          · golang-migrate SQL pairs (0001..0011)
├── services/
│   ├── gateway/                         · Go: Deriv WSS, NATS fan-out, order router, QuestDB ILP
│   ├── api/                             · FastAPI: auth, agents, decision loop, risk, postmortems, calendar, attribution, safety
│   └── models/
│       ├── ttm/                         · Granite TTM forecasting service
│       └── kronos/                      · Kronos-small forecasting service
└── apps/
    └── web/                             · Next.js 15 app (sidebar + topbar shell)
```

---

## License

Proprietary. All rights reserved.
