# TradeMaster

AI-orchestrated multi-model trading platform on Deriv. Multi-tenant SaaS,
launching in Zimbabwe. **Phases 0–5 shipped + the agentic loop (Manager
agent running 1:1s with employees, CEO follow-ups, conformal calibration,
web search). Running live A/B on the Deriv demo account today.**

See [PLAN.md](PLAN.md) for the full architecture spec and current
phase-by-phase status. AI session notes live in [AGENTS.md](AGENTS.md).

---

## Quick start

Requires Docker Desktop (the stack runs CPU TSFMs on an M1 MacBook Air with
8 GB just fine). For native Go / Node dev, you need Go 1.22+ and Node 22+.

```bash
cp .env.example .env       # fill in DERIV_API_TOKEN + LLM keys + optional TAVILY_API_KEY
make dev                   # bring the full stack up (postgres + 8 services)
make logs                  # tail everything
make migrate               # apply pending DB migrations
make down                  # stop
make clean                 # stop + wipe volumes (destroys local data)
```

Required environment:
- `DERIV_API_TOKEN` — Deriv demo or live account token
- `ANTHROPIC_API_KEY` — Claude (default Manager brain)
- `GEMINI_API_KEY` — Gemini Live (voice) + Gemini text models

Optional but recommended:
- `TAVILY_API_KEY` — cleaner AI-tuned web-search snippets. Without it,
  `web_search` falls back to DuckDuckGo HTML which is free but noisier.
  Switchable per-company at `/settings`.
- `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` — extra
  text models for the per-agent LLM picker.

Then open <http://localhost:3000> — you'll land on the live dashboard.
First-run flow: sign up → create company → seven starter agents
(Alpha manager + Trendy/Brakey/Rocky/Rev/Action employees + Scout
research) are seeded automatically.

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
- **Walk-forward backtest harness** + **web Backtests UI** (`/backtests`)
  — Kronos and TTM both backtestable in-browser; results push into a
  reviewable run history. Apply a backtest's recommendation directly to
  an agent's config in one click.
- **Forecast calibration** (`/agents/<id>` → Forecast calibration card)
  — daily isotonic / Platt fit on each model's recent settled trades;
  the decision loop applies the calibrated probability before the
  threshold gate. Verified: TTM Brier 0.157 → 0.088, Kronos-base
  0.351 → 0.236 (overconfident, decision gate now bites correctly).
- **Manager Agent loop** (`/meetings`) — every 4h the manager (Alpha)
  reviews team digest, makes targeted adjustments to employees (kelly
  fraction, confidence threshold, payoff ratio, allocation, daily
  target), and persists a full LLM transcript per review or 1:1.
  CEO can trigger reviews on demand, hold ad-hoc 1:1s with any
  employee, and follow up on any meeting from its detail page — the
  manager replays the full transcript and responds in-thread.
- **Employee → Manager messaging** — employees drop meeting requests
  when they notice a problem (loss streak, bad asset); manager picks
  up the queue at the next review and addresses each in summary.
- **Goal-aware sizing** — CEO sets a daily profit target on Settings;
  manager can set per-employee targets via tool. Decision loop reads
  today's realized P&L vs the more restrictive of company/employee
  target and stair-step throttles stake (≥50% → 75% sizing,
  ≥80% → halve, ≥100% → skip new trades). Throttle reason persists
  into the postmortem.
- **Voice for every agent** — Gemini Live ephemeral-token WSS direct
  from browser; per-agent voice picker (10 voices, "voice via Gemini
  Live · text brain: Claude" badge when an agent's chat model is
  non-Google). Voice button on agent profile and on every meeting page.
- **Internet search tool** — `web_search` available to all agents,
  gated per-company at `/settings`: enable/disable, allow/block
  domains, daily quota, backend choice (auto / Tavily / DuckDuckGo).
  Audit log in `web_search_log`. Search results render as clickable
  source cards in meeting transcripts.
- **Notifications** — bell in the topbar, polls every 30s, fires on
  every meeting completion (review + 1:1 + follow-up). Links straight
  to the meeting detail page.
- **Trading discipline gates** — `no_concurrent_position` per
  (agent, asset) refuses opposing or stacked trades; allocation
  accounting fix counts every open intent (not just pending). Both
  rejections render in the agent's live activity feed with the
  specific check name.
- **Per-agent live activity feed** — unified timeline merging trade
  intents (opened / filled / closed / rejected), postmortems, manager
  actions, and chat turns. Polls every 5s with a "+N new" pulse.
- **WebAuthn passkey gate** — leaving paper-mode requires a fresh
  passkey assertion on the active company; assertion JWT cookie
  expires after 5 minutes. Passkeys registered on `/passkeys`.
- **Symbol icons everywhere** — `frxEURUSD` renders as 🇪🇺🇺🇸 in the
  picker, postmortems, history, agents rail, and inline in any meeting
  transcript that mentions an asset by code.
- **TSFM ensemble forecaster** — hosted Chronos-2 + Moirai-2 via the
  unified TSFM.ai API as a third forecasting service. Multivariate
  attention captures cross-pair correlations TTM and Kronos miss
  entirely. Backtests over the same `POST /backtest` endpoint as the
  local services; concurrency-bounded so a sweep doesn't burst-bill.
- **Public landing + pricing page** — logged-out visitors hit a
  marketing site at `/` with feature highlights, honest limits, and
  a four-tier pricing table (Free / Starter / Pro / Enterprise). Logged
  in users still see the dashboard at the same route.
- **Per-company API keys** (`/settings`) — customers paste their own
  Deriv demo/real tokens + Anthropic / Gemini / OpenAI / OpenRouter /
  Groq keys. Stored Fernet-encrypted with a master key from env. The
  runtime LLM dispatch prefers the customer's key, falls through to
  platform env if unset. Voice mints against the customer's Gemini key.
  Deriv environment toggle (demo/real) with a 🔴 warning on real.
- **Direct member CRUD + password reset** — owner/admin creates a user
  with an initial password (with a "generate" button using an
  unambiguous alphabet), inline rename, and a Reset password button
  per row that returns a temp password in a copyable banner. The old
  invite-link flow is hidden in the UI but remains functional for any
  in-flight links.
- **Tier enforcement** — `app.tiers` is the single source of truth.
  Gates fire at agent CRUD (forecaster + employee count), member CRUD
  (seat cap), voice session mint, real-trading toggle, manager review
  loop, and web search quota. Each gate raises HTTP 402 with a
  structured payload the UI shows in-context. Settings page surfaces
  current tier + live usage bars.
- **Stripe billing** (Phase 4) — checkout sessions for Starter/Pro,
  customer portal for cancellation + invoices, webhook handler that
  flips `companies.tier_name` on `customer.subscription.*` events.
  Pricing CTAs become live checkout when the visitor is signed in;
  Settings page shows subscription status with a Manage subscription
  link. Operator can leave Stripe env unset to disable billing — the
  api still works (pricing CTAs fall through to signup).

---

## What's next

The agentic loop is feature-complete enough to run. Open work mostly
falls under "more models, more sources, more polish":

1. **More forecasting models** — Chronos-Bolt-small, TimesFM 2.5,
   Kronos-base ensemble. Pattern is well-established (mirror
   `services/models/kronos`).
2. **Sentiment ingestion** — Polymarket / Kalshi / Manifold / Finnhub
   news. PLAN §5 / §15. The manager already has `web_search`; adding
   structured sentiment moves it from ad-hoc lookups to systematic
   signal.
3. **Conformal calibration v2** — currently per-model only; per
   (model, asset) is the natural next granularity. Held off until
   per-asset N reaches the isotonic floor (≥ 80 settled per pair).
4. **14-day paper gate** before any real-money path. PLAN §27.
5. **Stripe + crypto-pay** + **ZW Shona translations** + **Lite mode**
   — real onboarding.
6. **Mobile** (PWA install + React Native).
7. **Cloud GPU tier** (Chronos-2 + FinCast 1B) — opt-in for heavier
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
├── migrations/                          · golang-migrate SQL pairs (0001..0022)
├── services/
│   ├── gateway/                         · Go: Deriv WSS, NATS fan-out, order router, QuestDB ILP, balance polling
│   ├── api/                             · FastAPI: auth, agents, decision loop, risk, postmortems, calendar, attribution, safety
│   │                                      + Manager agent loop (reviews, 1:1 meetings, follow-ups, notifications)
│   │                                      + forecast calibration (PAV isotonic + Platt scaling)
│   │                                      + web_search tool (Tavily / DuckDuckGo, per-company gated)
│   │                                      + Gemini Live ephemeral tokens for browser voice
│   └── models/
│       ├── ttm/                         · Granite TTM forecasting service
│       └── kronos/                      · Kronos-base/-small forecasting service
└── apps/
    └── web/                             · Next.js 15 app (sidebar + topbar shell)
        ├── /                            · live dashboard with goal-progress strip + agents rail
        ├── /agents                      · agent CRUD + voice picker + per-agent goals
        ├── /agents/[id]                 · profile + activity feed + calibration card + manager history
        ├── /meetings                    · all reviews + 1:1s with inline transcripts
        ├── /meetings/[id]               · meeting detail + voice call manager + follow-up reply
        ├── /manager                     · manager activity audit feed
        ├── /backtests                   · model backtest runs, apply recommendations
        ├── /postmortems · /history · /attribution · /edge · /payroll
        └── /settings                    · daily profit target, web-search config
```

---

## License

Proprietary. All rights reserved.
