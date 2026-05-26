# TradeMaster — AI-Orchestrated Multi-Model Trading System

**Version:** 1.0 (Final Plan) · **Last updated:** 2026-05-26 · **Owner:** Gregory Shoniwa
**Tenancy:** Multi-tenant SaaS · **Launch:** Zimbabwe → Africa
**Local dev:** MacBook Air M1, 8GB (full Docker dev stack, CPU TSFMs)
**Memory:** mem0 (Apache 2.0, self-hosted on pgvector)
**Design inspiration:** LITTLEBEE (dark + lime green) + AI-specific widgets

A production-grade autonomous trading platform that:

1. Hosts **multi-tenant Companies** with **Members** (humans) and **AI Agents** (configurable LLM-powered employees).
2. Lets each Company build its own AI trading firm — name agents, assign LLMs, allocate capital, set strategies, **define personality** (Sniper / Scalper / Hunter / Guardian / Balanced), choose **trade selection mode** (specific / most-profitable / safest / balanced).
3. **Phased asset unlocking** — Companies/Agents start with Forex Majors and progressively unlock Synthetic Indices, Commodities, Crypto, Vanilla Options, Accumulators, Turbos, and the full Deriv contract universe via proven performance.
4. **Economic-calendar-aware decisions** — Risk Agent enforces pre-/post-event blackouts on real-world markets; agents see countdown features and adapt strategy per event.
5. Connects to **Deriv WebSocket API** — all markets, all contract types via plugin registry.
6. Runs **five time-series foundation models** (Kronos, TimesFM, Chronos, FinCast, TTM) as forecast engines.
7. Encodes **five classical trading strategies** as configurable Employee behaviors.
8. **Real-money safeguards** — Kelly sizing · performance attribution · auto-deactivation · profit sweep · greed limits · cooling-off · edge report.
9. **Chat + voice** (Gemini Live API) with every Agent. **mem0** for per-user × per-agent persistent memory.
10. **CEO Agent-personality detection** — auto-computed Aggression Index + radar chart from observed behavior; override via preset or fine-grained control.
11. **LITTLEBEE-inspired** dashboard with `dark-lime` and `dark-cyan` (CVD-safe) themes.
12. Immutable, hash-chained audit trail. Full Docker dev → Docker + K8s prod.

---

## Table of Contents

1. [Critical Pre-Build Corrections](#1-critical-pre-build-corrections)
2. [System Architecture](#2-system-architecture)
3. [The Five Foundation Models (TSFMs)](#3-the-five-foundation-models-tsfms)
4. [The Five Trading Strategies](#4-the-five-trading-strategies)
5. [LLM Provider Selection (Pluggable)](#5-llm-provider-selection-pluggable)
6. [Multi-Tenant Companies & AI Agent Management](#6-multi-tenant-companies--ai-agent-management)
7. [Agent Personalities & Trade Selection Modes](#7-agent-personalities--trade-selection-modes)
8. [Phased Asset Class Enablement](#8-phased-asset-class-enablement)
9. [Economic Calendar Decision Engine](#9-economic-calendar-decision-engine)
10. [Agent Layer & Learning Loop](#10-agent-layer--learning-loop)
11. [Memory Architecture — mem0](#11-memory-architecture--mem0)
12. [Conversational Interface — Chat + Voice](#12-conversational-interface--chat--voice)
13. [Real-Money Enhancements](#13-real-money-enhancements)
14. [Hardware Tiers & Local Development](#14-hardware-tiers--local-development)
15. [Training Data & External Signal Sources](#15-training-data--external-signal-sources)
16. [Training & Fine-Tuning the Models](#16-training--fine-tuning-the-models)
17. [Deriv Integration — Full Contract Registry](#17-deriv-integration--full-contract-registry)
18. [Data Pipeline & Features](#18-data-pipeline--features)
19. [Backend Stack](#19-backend-stack)
20. [Frontend & Dashboard — Design Language](#20-frontend--dashboard--design-language)
21. [Design System](#21-design-system)
22. [Safety, Risk Controls & Trade Modes](#22-safety-risk-controls--trade-modes)
23. [Backtesting Framework](#23-backtesting-framework)
24. [Audit, Compliance & Regulatory](#24-audit-compliance--regulatory)
25. [Observability & Model Monitoring](#25-observability--model-monitoring)
26. [Dockerization & Deployment](#26-dockerization--deployment)
27. [Security & Secrets](#27-security--secrets)
28. [Cost Projection](#28-cost-projection)
29. [Phased Delivery Roadmap](#29-phased-delivery-roadmap)
30. [Open Questions & Risks](#30-open-questions--risks)
31. [Appendix A — Repository Layout](#31-appendix-a--repository-layout)
32. [Appendix B — Reference Links](#32-appendix-b--reference-links)
33. [Operations, Trust & Growth — Launch Readiness](#33-operations-trust--growth--launch-readiness-completeness)

---

## 1. Critical Pre-Build Corrections

### 1.1 — 1.7 carried (v0.1–0.4)

- **Gemini 3.5 doesn't exist** — use 3.1 Pro / 2.5 Pro / 2.5 Flash. (§5)
- **TTM is NOT a Transformer** — IBM Tiny Time Mixers (MLP-Mixer); Apache `granite-timeseries-ttm-r2`. (§3)
- **Polymarket is NOT training data** — runtime sentiment feature only. Train on Deriv ticks_history + Dukascopy + Binance. (§15)
- **LLMs ≠ TSFMs** — LLMs reason (brain); TSFMs forecast (tools). Don't substitute. (§5, §16)
- **Multi-tenant Companies + virtual allocation + pluggable LLM + dual trade mode + ZW-first.** (§6, §22)
- **Voice is UI, never authorization** — Risk Agent + Kill Switch voice-deaf; tap-confirm + WebAuthn for trades. (§22.7)
- **Memory: mem0 self-hosted on pgvector** with compound keys + per-Company collection. (§11)
- **Docker everywhere in dev** — CPU TSFMs inside containers (Mac MPS not passable); `dev-mps` override available. (§26)
- **Real-money safeguards** — Kelly · performance attribution · auto-deactivation · profit sweep · greed limits. (§13)
- **LITTLEBEE design language** with CVD-safe alternate theme. (§20, §21)

### 1.8 — v0.5 additions

| Decision | Detail |
|---|---|
| **Agent personalities** | Five presets — Sniper · Scalper · Hunter · Guardian · Balanced. Each preset configures Kelly fraction, confidence threshold, holding-time target, payoff-ratio requirement, max trades/day. Customizable per Agent. (§7) |
| **Trade selection modes** | Per-Agent: `specific` (whitelist of strategy×asset×contract combos), `most_profitable` (maximize EV), `safest` (high win-prob, tight stops), `balanced` (default). (§7) |
| **Aggression Index + radar** | Auto-computed from observed behavior. CEO sees each Agent's spectrum on a radar chart (Risk Appetite, Frequency, Holding Time, Confidence, Diversification, Recovery). (§7.5) |
| **Phased asset unlocking** | 9 tiers from Forex Majors → full Deriv contract universe. Each unlock requires successful trades + Sharpe gate + WebAuthn. (§8) |
| **Economic calendar decision engine** | Risk Agent enforces blackouts (±15min for high-impact events). Models receive `time_to_next_event` + `event_impact_score`. Strategies adapt per event class. Synthetic indices exempt (no real-world events). (§9) |
| **Full Deriv contract registry** | Plugin pattern. Each contract type (CALL/PUT, MULTUP/MULTDOWN, ACCU, TURBOS, Vanilla Options, Touch/No-Touch, Digits, Asians, Reset, etc.) is a registered plugin with proposal/buy/sell builders + risk param mapper + strategy compatibility. (§17) |

### 1.9 — v0.5.1 additions

| Decision | Detail |
|---|---|
| **Investing.com calendar** | Primary calendar source (50+ countries, deepest free coverage). Scraped via `investpy`. Cross-checked with Forex Factory + Finnhub + Trading Economics; blackout only when ≥2 sources agree. (§9.1) |
| **Trade Postmortem reports** | Every closed trade auto-generates a structured analysis: full entry decision trace (TSFM forecasts + employee opinions + memory recall + manager synthesis + risk validation + tier check), full exit decision trace (trigger, MFE/MAE, capture ratio), confidence levels at every step, plain-language narrative for the CEO. (§13.11) |
| **Per-trade Employee ratings** | Every Employee Agent rated on every trade across three dimensions — Direction Score, Calibration Score, Information Value Score. Composite rating ∈ [-1, +1]. Rolling 30/90/365-day windows. Drives leaderboard, performance-weighted ensembling, and auto-pause. (§13.12) |

### 1.10 — v1.0 launch-readiness additions

The core AI / trading / agent architecture is complete. v1.0 closes the **operational, trust, and growth** perimeter that blocks a real launch. See §33.

| Decision | Detail |
|---|---|
| **Account recovery** | BIP39 recovery codes + ≥2 registered passkeys + KYC re-verification with 72h cool-down. Castle.io for device anomaly detection (§33.1). |
| **Withdrawal hardening** | New address → 24h delay; >50% balance → step-up + Persona liveness check (§33.1). |
| **Support stack** | WhatsApp via 360dialog primary; Crisp helpdesk; Mintlify docs; Instatus status page; Telegram community (§33.2). |
| **Payments** | Paystack/Flutterwave + NOWPayments crypto + EcoCash/InnBucks ZW rails + USDT direct. Lago billing. (§33.3). |
| **Legal** | Bowmans / Manokore lawyer review (not Termly). ZW Cyber & Data Protection Act + POTRAZ DPO registration. ~$8–15k budget. (§33.4). |
| **Notifications** | Resend (email) · Web Push + FCM · 360dialog WhatsApp · Africa's Talking SMS · Novu/Knock orchestration (§33.5). |
| **Analytics** | PostHog Cloud EU for product; Plausible for marketing. No financial PII in session replay. (§33.6). |
| **Public API** | **Deferred to v2** — Svix when ready (§33.7). |
| **Feature flags** | GrowthBook self-hosted; gate every model/strategy/agent change (§33.8). |
| **ZW growth** | WhatsApp groups · YouTube creators · EcoCash partnership · UZ/NUST/HIT trading societies · double-sided referral with anti-abuse (§33.9). |
| **AI Use Policy + Model Cards** | Separate document from ToS. Per-TSFM model cards (training, weaknesses, drawdown ranges). (§33.10). |
| **Tax Center** | Build, don't buy. ZIMRA-formatted output. No vendor supports ZW. (§33.11). |
| **Admin abuse prevention** | Signal embargo · admin trade-lockout window · two-person rule for config changes · weekly position disclosure ledger. (§33.12). |
| **DR/Incident** | RTO ≤ 1hr / RPO ≤ 5min for trading data. Grafana OnCall. Quarterly chaos drills. (§33.13). |
| **Onboarding** | 14d / 50-trade paper gate · Shepherd.js tutorial · 70%-pass knowledge-check quiz · Shona-subtitled Loom walkthroughs. (§33.14). |
| **Launch-day discipline** | UTC everywhere internally · NUMERIC not float · idempotency keys · client-side Deriv rate-limiter · "first big winner" comms template ready · dollar-denominated alerting · documented bus-factor ≥2. (§33.15). |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          USER (Browser)                           │
│   Next.js 16 · LITTLEBEE-inspired UI                              │
│   • Company switcher  • Agent gallery (personality + radar)       │
│   • Position Size Calc  • Market Hours Globe  • Econ Events       │
│   • Asset Tier Unlock UI  • Trade Mode toggle                     │
└────────────────────────────┬─────────────────────────────────────┘
                             │  WSS data + WSS voice audio
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  GO GATEWAY (Docker)                              │
│   Auth · Tenancy scope · Fan-out · Kill-switch · Order Router     │
│   Approval Queue · Voice Proxy · Slippage guard · Event Blackout  │
└─────────┬─────────────────────────────────┬─────────────────────┘
          │ WSS                              │ NATS subjects
          ▼                                  ▼
┌────────────────────┐         ┌─────────────────────────────────┐
│  DERIV WEBSOCKET   │         │       NATS JETSTREAM BUS         │
│  api.derivws.com   │         │  ticks · candles · features      │
│  (per-Company)     │         │  events.calendar (NEW v0.5)      │
└────────────────────┘         │  signals · decisions · trades    │
                               │  voice · learn · audit · tier    │
                               └──────┬──────────────┬───────────┘
                                      │              │
                                      ▼              ▼
                       ┌──────────────────────┐ ┌─────────────────┐
                       │  FASTAPI SERVICES    │ │ AGENT ORCHESTR. │
                       │  Features · Backtest │ │ LangGraph + mem0│
                       │  Company/Member/Agent│ │ N Managers      │
                       │  Voice Bridge        │ │ N×5 Employees   │
                       │  Perf Attribution    │ │ Personality     │
                       │  Calendar Ingestor   │ │   Detector      │
                       │  Tier Manager        │ │ Learning Worker │
                       └──────────┬───────────┘ └──────┬─────────┘
                                  │                    │  tool calls
                                  ▼                    ▼
        ┌─────────────────────────────────────────────────────────┐
        │     TSFM MODEL SERVERS (Docker on CPU for dev)           │
        │     TTM · Kronos · Chronos-Bolt · TimesFM · FinCast      │
        │     + Optional RL Execution Agent (PPO/DQN, Phase 7+)    │
        └─────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
   │   QUESTDB       │  │   POSTGRES 17   │  │   REDIS 7.4      │
   │  ticks/candles  │  │  + pgvector     │  │  cache · sessions│
   │  features       │  │  multi-tenant   │  │  approval queue  │
   │  econ calendar  │  │  trades · audit │  │  voice sessions  │
   │                 │  │  mem0 vectors   │  │  event blackouts │
   │                 │  │  tier states    │  └──────────────────┘
   └─────────────────┘  └─────────────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │  S3 (Object Lock)    │
                       │  Audit + voice WORM  │
                       └──────────────────────┘
```

Everything boxed runs in Docker. Local dev = `docker compose up`. Production = same images on Kubernetes.

---

## 3. The Five Foundation Models (TSFMs)

| Model | Type | Params | License | Quantiles | Exogenous | M1 CPU dev |
|---|---|---|---|---|---|---|
| **Kronos-small** | Decoder-only AR (K-line) | 24.7M | MIT | Sampled | OHLCV-fixed | ~50ms |
| **Kronos-base** | same | 102M | MIT | Sampled | OHLCV-fixed | ~200ms |
| **TimesFM 2.5** | Patched decoder | 200M | Apache 2.0 | Native | Univariate only | ~300ms |
| **Chronos-Bolt-small** | T5 quantile | 45M | Apache 2.0 | Native | Univariate | ~40ms |
| **Chronos-2** | Quantile + universal | 120M | Apache 2.0 | Native + custom | Past + future cov. | Cloud preferred |
| **FinCast** | Sparse MoE | 1B | Apache 2.0 | Native | Multi-domain finance | Cloud only |
| **TTM (granite-r2)** | TSMixer (MLP-Mixer) | ~1–5M | Apache 2.0 | Point* | Multivariate + static | ~10ms |

*Conformal calibration on top of TTM for intervals.

**Local roster on M1 (full Docker, CPU):** TTM · Kronos-small · Kronos-base · Chronos-Bolt-small · TimesFM 2.5. Total cycle <500ms.
**Cloud upgrade:** add Chronos-2 + FinCast 1B on L40S 48GB GPU.

### 3.1 Standard forecast envelope

```json
{
  "model": "kronos-small",
  "model_version": "NeoQuasar/Kronos-small@sha256:...",
  "weights_hash": "sha256:...",
  "asset": "1HZ100V",
  "frequency": "1m",
  "asof_ts": 1748284800,
  "horizon_steps": 24,
  "forecast": [{"t": ..., "p10": ..., "p50": ..., "p90": ...}, ...],
  "point_direction": "up",
  "confidence_score": 0.72,
  "latency_ms": 87,
  "features_used": ["open","high","low","close","volume","time_to_next_event"]
}
```

---

## 4. The Five Trading Strategies

Implemented as deterministic Python modules + LLM-wrapped Strategy Agents.

### 4.1 Trend Trading
EMA(50)×EMA(200) cross + ADX(14) ≥ 25. Entry on EMA(21) pullback + MACD flip. TSFM check: 3/5 agree. Exit: 2×ATR trail or trend flip.

### 4.2 Breakout & Retest
50-period level break ≥0.5×ATR on ≥1.5× volume. Retest entry on rejection candle. TSFM check: ensemble continues ≥1×ATR in 20 bars.

### 4.3 Support & Resistance
200-bar swing highs/lows clustered ≤0.3×ATR. Setup on momentum-slowing approach. TSFM check: 3/5 reverse in 10 bars.

### 4.4 Mean Reversion
Hurst <0.45, OU half-life <30 bars, outside BB(20,2), |z|>2.5, RSI extreme. TSFM check: ensemble q50 returns to mean; FinCast agrees.

### 4.5 Price Action
Pin/engulfing/inside-bar/three-bar/fakey. TSFM check: Kronos confidence >0.65.

### 4.6 Strategy × asset defaults (configurable per Agent)

| Asset | Trend | Brk | S/R | MR | PA |
|---|---|---|---|---|---|
| Vol 75, 1HZ100V | ✓ | ✓ | ✓ | ✓ | ✓ |
| EUR/USD, GBP/USD | ✓ | ✓ | ✓ | ✓ | ✓ |
| XAU/USD | ✓ | ✓ | ✓ |  | ✓ |
| BTC/USD, ETH/USD | ✓ | ✓ |  |  | ✓ |
| Crash 1000, Boom 1000 |  | ✓ |  | ✓ | ✓ |

### 4.7 StrategySignal envelope

```json
{
  "strategy": "trend_following",
  "agent_id": "agt_01H...",
  "asset": "1HZ100V",
  "verdict": "BUY",
  "confidence": 0.78,
  "size_hint_pct": 1.5,
  "horizon_bars": 12,
  "entry_price": 312.4,
  "stop_loss": 309.2,
  "take_profit": 318.8,
  "expected_payoff_ratio": 2.5,
  "win_probability": 0.62,
  "expected_value_usd": 4.20,
  "event_aware_flag": "calendar_clear",
  "rationale": "EMA50>EMA200, ADX=31, 4/5 TSFMs agree.",
  "supporting_models": ["kronos-small","timesfm-2.5","chronos-bolt-small","fincast"],
  "dissenting_models": ["ttm"]
}
```

The `expected_payoff_ratio`, `win_probability`, and `expected_value_usd` fields (new in v0.5) drive the trade-selection modes in §7.

---

## 5. LLM Provider Selection (Pluggable)

`LLMAdapter` interface: `chat(messages, tools, response_format, max_tokens, temperature)`. Per-Company per-Agent token+cost accounting.

| Provider | Models | Strength |
|---|---|---|
| **Anthropic** | Opus 4.7 / Sonnet 4.6 / Haiku 4.5 | Best agentic + tool use. Default Manager. |
| **OpenAI** | GPT-5 / GPT-4o | Mature SDK; instructable; fine-tune. |
| **Google** | Gemini 3.1 Pro / 2.5 Pro / 2.5 Flash | 1–2M context; cheap Flash; **only realistic voice option**. |
| **Groq** | Llama-3.1-8B / 3.3-70B | Ultra-fast for mem0 fact extraction. |
| **Local** (Ollama/MLX) | Llama-3.2-3B · Phi-3-mini · Qwen2.5-7B | M1 8GB ≤3B comfortable. |

### Default assignments
| Role | Recommended |
|---|---|
| Manager | Claude Sonnet 4.6 |
| Strategy Employees ×5 | Gemini 2.5 Flash or Claude Haiku 4.5 |
| Research | Gemini 2.5 Flash |
| Voice | Gemini 2.5 Flash Live |
| mem0 extraction | Groq Llama-3.1-8B |
| Risk | — Python deterministic — |

Prompt-injection hardening: `<user_data>` wrapping, length-clamped tool outputs, allowlisted tools, Risk Agent final gate.

---

## 6. Multi-Tenant Companies & AI Agent Management

### 6.1 Entity model

```
Account → owns N Companies
Company → has N Members (humans) + N AI Agents + 1+ Deriv connections
Agent → name + LLM + voice + strategies + personality + tier + capital + risk caps
```

### 6.2 Postgres schema (core, with v0.5 extensions)

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,                          -- fed to agents via mem0
  phone TEXT,
  jurisdiction TEXT NOT NULL,
  webauthn_creds JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE companies (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  brand_color TEXT,
  ceo_account_id UUID REFERENCES accounts(id),
  base_currency TEXT NOT NULL DEFAULT 'USD',
  paper_mode BOOLEAN NOT NULL DEFAULT TRUE,
  paper_unlocked_at TIMESTAMPTZ,
  current_asset_tier SMALLINT NOT NULL DEFAULT 1,   -- v0.5 (§8)
  unlocked_contract_types TEXT[] DEFAULT '{"MULTUP","MULTDOWN"}', -- v0.5 (§17)
  event_aware_trading BOOLEAN DEFAULT TRUE,         -- v0.5 (§9)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE company_members (
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','trader','viewer')),
  title TEXT,                                       -- "CEO", "Risk Officer"
  invited_by UUID REFERENCES accounts(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (company_id, account_id)
);

CREATE TABLE deriv_connections (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  api_token_enc BYTEA NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance_cached NUMERIC(18,8),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agents (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL CHECK (role IN ('manager','employee','research')),
  reports_to_agent_id UUID REFERENCES agents(id),
  llm_provider TEXT NOT NULL,
  llm_model TEXT NOT NULL,
  llm_config JSONB NOT NULL,
  voice_id TEXT,
  voice_enabled BOOLEAN DEFAULT TRUE,
  strategies TEXT[] DEFAULT '{}',
  allowed_assets TEXT[] DEFAULT '{}',                -- v0.5 (§8)
  allowed_contract_types TEXT[] DEFAULT '{}',        -- v0.5 (§17)
  deriv_connection_id UUID REFERENCES deriv_connections(id),
  allocated_balance_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_position_size_usd NUMERIC(18,2) NOT NULL DEFAULT 25,
  max_daily_drawdown_pct NUMERIC(5,2) NOT NULL DEFAULT 5.0,
  -- v0.5 personality & trade selection
  personality TEXT NOT NULL DEFAULT 'balanced'
    CHECK (personality IN ('sniper','scalper','hunter','guardian','balanced','custom')),
  trade_selection_mode TEXT NOT NULL DEFAULT 'balanced'
    CHECK (trade_selection_mode IN ('specific','most_profitable','safest','balanced')),
  kelly_fraction NUMERIC(5,4) DEFAULT 0.25,
  min_confidence_threshold NUMERIC(5,4) DEFAULT 0.55,
  min_payoff_ratio NUMERIC(5,2) DEFAULT 1.5,
  max_trades_per_day INT DEFAULT 20,
  target_holding_secs INT,                           -- null = any
  event_aware BOOLEAN DEFAULT TRUE,                  -- override Company default
  -- computed/observed
  aggression_index SMALLINT DEFAULT 50,              -- 0-100, auto-updated daily
  detected_personality TEXT,                          -- observed vs declared
  observed_metrics JSONB DEFAULT '{}'::jsonb,
  trade_mode TEXT NOT NULL DEFAULT 'approve_each',
  is_active BOOLEAN DEFAULT FALSE,
  is_paused BOOLEAN DEFAULT FALSE,
  pause_reason TEXT,
  system_prompt_addendum TEXT,
  performance_stats JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES accounts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON agents (company_id, role);
CREATE INDEX ON agents (company_id, personality);
```

All trade-related tables carry `company_id`. **Row-level security** enforces tenant isolation.

### 6.3 Roles & permissions

| Role | Can do |
|---|---|
| **Owner** | All: billing, delete, transfer |
| **Admin** | Manage members/agents/strategies/Deriv |
| **Trader** | Manual trades; chat/voice |
| **Viewer** | Read-only; chat allowed |

### 6.4 Onboarding

1. Sign up (magic link + WebAuthn)
2. Create Company / accept invite
3. Add Deriv API token (demo by default)
4. Add LLM API keys (at least one)
5. Pre-created starter Agent set:
   - Manager **Alpha** (Claude Sonnet, Balanced personality)
   - Employees: **Trendy** · **Brakey** · **Rocky** · **Rev** · **Action**
   - Research **Scout** (Gemini Flash)
6. User reviews each Agent: rename, change LLM/voice/personality/strategy/allocation
7. **Starting tier: Tier 1 Forex Majors** (§8); other markets locked
8. Invite Members
9. 14-day paper trade → unlock live

### 6.5 Virtual capital allocation

Company shares its master Deriv balance. Each Agent has virtual `allocated_balance_usd` enforced by Risk Agent. Per-Manager separate Deriv accounts is opt-in (Phase 8+).

### 6.6 Auditability

Every Agent action tagged with `agent_id` + `agent_version_hash` (snapshot of system prompt + tools + LLM model + personality + tier). Old decisions reference old versions even after edits.

---

## 7. Agent Personalities & Trade Selection Modes

This is how the CEO shapes what each Agent actually does. Two orthogonal axes:

- **Personality** = the Agent's behavioral fingerprint (how often it trades, how big, how long it holds, how confident it must be).
- **Trade Selection Mode** = the policy by which the Agent picks among available setups.

The CEO sets both. The system also **observes** actual behavior and reports back — if you declared "Sniper" but the Agent is acting like a Scalper, the dashboard tells you.

### 7.1 The five personality presets

Each preset is a tuple of parameters. Customizable, but presets give the CEO a one-click starting point.

| Preset | Kelly | Min conf | Min payoff | Max trades/day | Target hold | Style |
|---|---|---|---|---|---|---|
| **Sniper** | 0.50 | 0.75 | 2.5 | 3 | 30–60 min | Few, high-conviction, big-edge trades |
| **Scalper** | 0.10 | 0.55 | 1.2 | 50 | 30–120 sec | Many small wins, tight stops |
| **Hunter** | 0.30 | 0.65 | 2.0 | 12 | 10–30 min | Medium frequency, highest-EV setups |
| **Guardian** | 0.10 | 0.70 | 1.5 | 8 | 5–15 min | Capital preservation, only safest setups |
| **Balanced** | 0.25 | 0.60 | 1.5 | 20 | 5–15 min | Default — versatile mix |

(`Kelly` = fractional Kelly multiplier · `Min conf` = minimum win-probability the Agent will accept a setup · `Min payoff` = minimum payoff ratio (TP-distance / SL-distance) · `Max trades/day` = circuit breaker.)

### 7.2 Custom personality

Beyond presets, the CEO can set every parameter directly. Saved as `personality='custom'`. Useful for niche use cases ("I want a Trend Sniper that only trades XAU/USD during London open").

### 7.3 Trade Selection Modes

Even within the same personality, an Agent can pick trades by different policies:

#### 7.3.1 `specific` mode
Whitelist of allowed (strategy, asset, contract_type) combinations. Agent rejects everything else. Example:
```json
{
  "allowed_combinations": [
    {"strategy": "trend_following", "asset": "EUR/USD", "contract": "MULTUP"},
    {"strategy": "mean_reversion",  "asset": "1HZ100V",  "contract": "MULTDOWN"}
  ]
}
```
Used when CEO has a specific edge they want pursued and nothing else.

#### 7.3.2 `most_profitable` mode
For every candidate StrategySignal, compute:
```
expected_value = win_probability * payoff_ratio * stake - (1-win_probability) * stake
```
Take the candidate with highest expected value above a minimum threshold. Higher tolerance for wide stops if EV justifies it.

#### 7.3.3 `safest` mode
For every candidate, score by:
```
safety_score = win_probability * (1 / (sl_distance_atr * regime_volatility))
```
Take the candidate with the lowest variance + highest win probability, even if payoff is small. Designed for capital preservation. Refuses any setup where TSFM uncertainty band crosses entry or stop.

#### 7.3.4 `balanced` mode (default)
Standard agent logic — manager-synthesized verdict across all employee opinions. No bias toward profit or safety; trust the agent's reasoning.

### 7.4 How modes affect the StrategySignal flow

```
Employee evaluates strategy rules + TSFM forecasts
    ↓
Computes win_probability, payoff_ratio, expected_value
    ↓
Manager receives N candidate StrategySignals
    ↓
Manager applies Agent's trade_selection_mode:
    specific      → reject if combo not whitelisted
    most_profitable → pick max EV
    safest        → pick max safety_score
    balanced      → pick best overall judgment
    ↓
TradeIntent → Risk Agent → ...
```

### 7.5 Aggression Index — auto-detected

Compute daily, per Agent:

```
aggression_index = w1·kelly_fraction
                 + w2·(avg_position_pct / max_position_pct)
                 + w3·(trades_per_day / 50)
                 + w4·(1 - avg_holding_time_secs / 1800)
                 + w5·(strategies_active / 5)
                 + w6·(avg_loss_to_gain_ratio)
                 scaled to 0-100
```

Tags:
- 0-20: **Very Conservative**
- 21-40: **Conservative**
- 41-60: **Balanced**
- 61-80: **Aggressive**
- 81-100: **Very Aggressive**

If declared personality ≠ detected personality, dashboard surfaces a banner: *"You set Trendy to **Sniper**, but it's been acting **Scalper** (aggression 73, 38 trades/day). Want to recalibrate?"*

### 7.6 Agent profile radar (UI)

Six-axis radar chart per Agent (see §20.7 mockup):

- **Risk Appetite** — avg position size as % of allocation
- **Frequency** — trades/day
- **Holding Time** — avg position duration (inverted; shorter = higher score)
- **Confidence Threshold** — min confidence of taken trades
- **Diversification** — entropy across strategies × assets
- **Recovery Speed** — how fast P&L recovers after a loss

CEO can compare two Agents' radars side-by-side ("Is Trendy more aggressive than Rev?").

### 7.7 LLM prompt injection

Personality + trade selection mode flow into the Agent's prompt:

```
You are a {personality} Agent on the {strategy_name} strategy.

Personality parameters:
- Min confidence to act: {min_confidence_threshold}
- Min payoff ratio (TP/SL): {min_payoff_ratio}
- Max trades today: {max_trades_per_day} (today so far: {trades_today})
- Target holding time: {target_holding_secs}s
- Kelly fraction: {kelly_fraction}

Trade selection mode: {trade_selection_mode}
- If "safest": reject setups where TSFM band crosses entry/stop. Prefer high
  win probability over big payoff.
- If "most_profitable": pick the setup with the highest expected value.
  Accept wider stops if EV justifies.
- If "specific": only act on these (strategy×asset×contract) combos: {...}
- If "balanced": use your best judgment.

Allowed assets right now: {allowed_assets}
Allowed contract types: {allowed_contract_types}
```

### 7.8 Personality switching impact

When CEO changes an Agent's personality:
- New parameters take effect on the next decision cycle.
- mem0 records the change: "On 2026-05-26 Gregory changed Trendy from Balanced to Sniper, citing 'too many small losses'."
- Performance attribution before/after the switch is shown clearly so the CEO can evaluate the change.

---

## 8. Phased Asset Class Enablement

Don't dump the full Deriv universe on a new Company. Phase it. Each tier unlock requires proven performance.

### 8.1 The nine tiers

| Tier | Adds | Markets | Contracts |
|---|---|---|---|
| **1** | Forex Majors | EUR/USD, GBP/USD, USD/JPY, USD/CHF | MULTUP, MULTDOWN |
| **2** | Synthetic Indices (Vol) | + R_75, R_100, 1HZ100V | + ACCU (Accumulators) |
| **3** | Forex Minors + Commodities | + USD/CAD, AUD/USD, EUR/GBP, XAU/USD, XAG/USD | (same) |
| **4** | Crypto | + BTC/USD, ETH/USD | (same) |
| **5** | Crash/Boom Indices | + Crash 1000, Boom 1000, Crash 500, Boom 500 | + TURBOSLONG, TURBOSSHORT |
| **6** | Stock Indices | + US500, US Tech 100, Wall Street 30 | (same) |
| **7** | Vanilla Options | (Vol indices) | + VANILLALONGCALL, VANILLALONGPUT |
| **8** | Higher/Lower + Touch/No Touch | (extended) | + CALL/PUT classic, HIGHER/LOWER, ONETOUCH/NOTOUCH |
| **9** | Specialized | Step Index, Range Break, Jump | + DIGITDIFF/DIGITMATCH/DIGITOVER/DIGITUNDER/DIGITEVEN/DIGITODD, ASIANU/ASIAND, RESETCALL/RESETPUT, TICKHIGH/TICKLOW |

(Tier 9 covers all remaining Deriv contracts — the full universe.)

### 8.2 Unlock criteria

To unlock Tier `N+1`:

1. ≥ **30 days** at Tier N (paper or live)
2. ≥ **50 trades** at Tier N
3. **Sharpe ≥ 1.0** over those 50 trades
4. **Max drawdown < 60% of DD limit** at Tier N
5. **Risk-disclosure acknowledgement** for the new tier (Shona + English)
6. **WebAuthn confirm** for Tiers 5+

If criteria not met, system suggests what's blocking ("You need 12 more profitable trades in Tier 2 to unlock Tier 3").

### 8.3 Per-Agent vs Per-Company tier

Default: tier is at the **Company level** — all Agents in a Company share the same allowed markets.

Advanced: per-Agent override (Tier ≤ Company tier). Useful for keeping one Agent specialized:
- "I unlocked Tier 4 for the company, but I want my Sniper to stay on Forex Majors only."

### 8.4 Forced staying-on-tier

CEO can also *prevent* unlock: "Lock my Sniper at Tier 1 forever." No upward pressure. Specialization is encouraged.

### 8.5 Demo tier (for fast testing)

Paper trading bypasses the tier requirements. CEO can paper-trade Tier 9 from day one to evaluate setups. Live unlock still gated.

### 8.6 Tier UI

A "Tier Map" screen shows:
```
Tier 1 ✅ Unlocked   Forex Majors           [active]
Tier 2 ✅ Unlocked   + Synthetic Indices    [active]
Tier 3 🔓 Eligible   + Forex Minors + XAU   [Unlock →]
Tier 4 🔒 Locked     + Crypto               (12 more profitable trades in Tier 2 needed)
Tier 5 🔒 Locked     + Crash/Boom           
...
```

Per-asset toggles let the CEO enable/disable specific markets within an unlocked tier ("I unlocked Tier 4 but I don't want any ETH/USD exposure").

### 8.7 Tier × personality interaction

A new Company starting on Tier 1 with five Guardian Employees can paper-trade safely for two weeks, prove edge, and unlock further tiers. Aggressive personalities don't unlock faster — discipline is required regardless.

### 8.8 What this gives the CEO

Three useful properties:

1. **Risk-bounded onboarding** — no one starts with $25 risking it all on Boom 1000.
2. **Skill-gated discovery** — users earn access by demonstrating they understand each market.
3. **Specialization support** — power users can keep certain Agents specialized forever.

---

## 9. Economic Calendar Decision Engine

Real-world economic events (NFP, FOMC, CPI, ECB) move forex / commodities / stock indices violently. Trading through them is gambling, not edge. **The system treats the calendar as a first-class decision input.**

### 9.1 Data sources

| Source | Use |
|---|---|
| **Investing.com** | Most comprehensive free calendar (50+ countries, deep history, actual/forecast/previous + impact). No public API — use [`investpy`](https://github.com/alvarobartt/investpy) or scrape unofficial JSON endpoint. Primary calendar source. |
| **Forex Factory** | Cross-check via Apify scraper or community Python tools. Free, well-structured. Secondary source for redundancy. |
| **Finnhub** | Earnings, IPO, US economic calendar. Free 60 req/min. Used for US-specific event detail and earnings/IPO not on Investing.com. |
| **Trading Economics** | Calendar API (3 countries free; paid for full). Fallback when Investing.com is rate-limited. |
| **Kalshi** | Event resolution probabilities (CFTC-regulated). Adds "market-implied" signal to events. |

**Three-source cross-check rule**: an event proceeds to blackout enforcement only if Investing.com **AND** at least one of (Forex Factory, Finnhub, Trading Economics) agrees on timestamp ± 1 min. Discrepancies are logged for ops review and don't trigger blackouts (false-positive guard).

Ingested by a `calendar-ingestor` FastAPI service, normalized to:

```json
{
  "event_id": "ff_2026_06_06_us_nfp",
  "ts": 1749225600,
  "country": "US",
  "name": "Non-Farm Payrolls",
  "impact": "high",
  "category": "employment",
  "previous": 280000,
  "forecast": 195000,
  "actual": null,
  "affected_currencies": ["USD"],
  "affected_assets": ["EUR/USD","GBP/USD","USD/JPY","XAU/USD","US500"]
}
```

Stored in QuestDB (time-series) + Postgres (current/upcoming snapshot). Published to NATS subject `events.calendar.{country}` on update.

### 9.2 Asset-event mapping

Not every event affects every asset:

| Event | Affects |
|---|---|
| US NFP, FOMC, CPI, GDP | USD pairs, gold, US indices |
| ECB rate, EU CPI | EUR pairs |
| BoE rate, UK GDP | GBP pairs |
| BoJ rate, JP CPI | JPY pairs |
| China PMI, GDP | AUD, NZD (proxies), commodities |
| OPEC meetings | Oil; gold |
| ETF approvals, Fed crypto policy | BTC/USD, ETH/USD |

**Synthetic indices (Vol, Crash, Boom, Jump, Step, etc.) are NOT affected by real-world events** — they're pure GBM streams. The engine bypasses calendar logic for these assets.

### 9.3 Decision-time hooks

The engine influences three layers:

**Layer 1 — Risk Agent blackout (hard gate)**

For affected assets, by impact level:

| Impact | Pre-event blackout | Post-event blackout | Sizing reduction |
|---|---|---|---|
| **High** (NFP, FOMC, CPI, rate decisions) | 15 min before | 30 min after | 0% during; 50% for next 2hr |
| **Medium** (PMI, retail sales, jobless claims) | 5 min before | 10 min after | 0% during; 75% for next 1hr |
| **Low** (everything else) | None | None | None |

If a TradeIntent arrives for an affected asset during a blackout, Risk Agent rejects with `reason="event_blackout"`. Audit logged with event_id.

**Layer 2 — Feature engineering (soft signal)**

Two new model input features:

```
time_to_next_high_impact_event_secs  (minutes until next high-impact event for this asset)
time_since_last_high_impact_event_secs  (minutes since last)
event_impact_score  (0-3 for asset's calendar density in next 60 min)
```

These flow to Chronos-2, TTM, FinCast (the multivariate models). Models learn to widen confidence bands when events approach — improving forecast calibration.

**Layer 3 — Strategy adaptation**

Strategy-specific rules:

| Strategy | Behavior near events |
|---|---|
| **Trend** | Pause 30 min before through 60 min after high-impact. Trends often reverse on news. |
| **Breakout & Retest** | More aggressive *after* high-impact (event-driven breakouts are the most reliable). Wait 10 min for whipsaw to settle. |
| **S/R** | Skip S/R trades within 1 hour of high-impact (levels often violated). |
| **Mean Reversion** | Aggressive 30-60 min *after* high-impact (overshoots tend to revert). |
| **Price Action** | Most cautious — pin bars during news are often fake. Only act on clear post-event reversal patterns. |

**Layer 4 — Agent prompt awareness**

When events are near, system prompt includes:

```
EVENT CONTEXT:
- US NFP releases in 11 minutes — high impact on USD pairs and gold
- Last 5 NFPs: 4 caused >0.5% moves in EUR/USD
- Gregory has previously asked you to be cautious before NFP

You should avoid initiating new positions in {affected_assets} for the next
{minutes_to_event} minutes. Close any in-flight trades that won't have a stop
in profit by event time.
```

### 9.4 Per-Company / Per-Agent override

CEO can toggle `event_aware_trading` at Company level (defaults true). Per-Agent override allowed:
- A Sniper agent might intentionally hunt event volatility (set `event_aware=false`, but with extra-tight stops and reduced size — Risk Agent enforces).
- A Guardian agent ignores events even on synthetic indices (paranoid by design).

### 9.5 Calendar widget UI

Already in the dashboard (§20.4). Click an event row to see:
- Affected assets
- Historical reaction magnitude
- Agents currently affected (blacked out)
- Manual override toggle

### 9.6 Compliance benefit

Pre-event blackouts also provide cover against accusations of trading on leaked information. If a regulator ever asks "why did your AI place a trade 30 seconds before CPI?", the audit log shows: it didn't — Risk Agent blocked it.

---

## 10. Agent Layer & Learning Loop

### 10.1 Topology (per Company)

- **N Manager Agents** (LLM) — coordinate Employees per asset slice
- **5+ Strategy Employees per Manager** (LLM) — call TSFMs as tools
- **1 Research Agent** (LLM) — Polymarket / Kalshi / Finnhub / GDELT
- **1 Risk Agent** (Python, deterministic) — limits + event blackouts + tier checks
- **1 Memory Service** — mem0 + Postgres (§11)
- **1 Learning Worker** — weekly distillation, drift detection, auto-pause
- **1 Personality Detector** — daily computes Aggression Index from observed trades
- **1 Performance Attribution Service** — per-Agent / strategy / regime / asset / event

### 10.2 Per-asset decision cycle

```
T+0ms    features.{symbol} published with event_aware flags
T+10ms   5 TSFMs publish forecasts
T+150ms  Manager picks Employees to activate by regime
         Employees consume features + forecasts + mem0 + outcome recall
         → publish StrategySignals (with EV, win_prob, payoff_ratio)
T+800ms  Manager applies Agent's trade_selection_mode + personality params
         → TradeIntent
T+820ms  Risk Agent validates:
           - hard limits, slippage, account state
           - Kelly sizing check
           - event blackout check (§9)
           - tier whitelist check (§8)
           - personality cool-down check (max_trades_per_day)
           - profit-sweep / greed limit check
T+830ms  Mode router: autonomous / approve_each / approve_above_threshold
T+900ms+ Trade executes → outcome closes → Learning Worker updates
         mem0 + agent_memory + perf_attribution + aggression_index
```

### 10.3 Decision context — what each Agent sees

1. Raw TSFM forecasts (5)
2. Strategy rule output
3. Indicator state (RSI/MACD/ATR/ADX/Bollinger/Hurst/OU)
4. Exogenous signals (Polymarket/Kalshi probs, sentiment momentum)
5. **Economic calendar features** (`time_to_next_event`, `event_impact_score`)
6. **Personality + trade-selection-mode parameters**
7. **Allowed assets + contract types** (current tier)
8. mem0 conversational recall
9. Postgres outcome recall (top-k similar past trades)
10. Learned lessons
11. Manager directive
12. Performance attribution feedback
13. User configuration

Rationale field cites which inputs drove the decision.

### 10.4 LangGraph state

```python
class TradingState(TypedDict):
    company_id: str
    asset: str
    asof_ts: int
    feature_window: dict
    model_forecasts: dict[str, Forecast]
    strategy_signals: list[StrategySignal]
    research_brief: ResearchBrief | None
    calendar_context: CalendarContext       # v0.5
    mem0_recall: list[MemoryHit]
    outcome_recall: list[OutcomeRecall]
    manager_verdict: TradeIntent | None
    risk_verdict: RiskVerdict | None
    user_approval: UserApproval | None
    execution: ExecutionResult | None
    audit_trail: list[AuditEvent]
```

### 10.5 Auto-deactivation rules

- Rolling 30-day Sharpe < 0 AND ≥20 trades → auto-pause
- Rolling 7-day drawdown > 1.5× backtest max → auto-pause
- Slippage > 2σ on 10 consecutive → auto-pause
- 3 consecutive auto-pauses in 90 days → mandatory retraining

Auto-pauses surface in dashboard. Owner/admin reactivates manually (WebAuthn).

---

## 11. Memory Architecture — mem0

### 11.1 Why mem0

Apache 2.0, mature (50K+ stars, May 2026), self-hostable on pgvector. Auto-extracts facts from chat/voice; A.U.D.N. dedup (Add/Update/Delete/No-op); hybrid retrieval (semantic + BM25 + entity graph).

### 11.2 Two gotchas, our workarounds

| Gotcha | Workaround |
|---|---|
| OSS lacks first-class tenant isolation | Compound keys `f"{company_id}:{user_id}"`; separate Qdrant/pgvector collection per Company |
| Cannot compound-scope `user_id AND agent_id` | Two scoped searches, merged + re-ranked in our code |

### 11.3 Scopes

```
mem0 collection: company_{company_id}_vectors
user_id   = f"{company_id}:{user_id}"
agent_id  = f"{company_id}:{agent_id}"
run_id    = session_id
metadata  = {company_id, kind, asset?, ts}
```

All searches go through a wrapper enforcing `metadata.company_id` matches the caller's tenant.

### 11.4 What goes where

| Data | System of record | Why |
|---|---|---|
| Trades, balances, audit | Postgres (+ S3 WORM) | ACID, queryable, regulator-grade |
| Trade-outcome memory (context → P&L) | Postgres pgvector | Structured exact joins |
| Conversational facts (CEO name, prefs, advice given) | mem0 | Fuzzy, auto-extracted |
| Voice transcripts | S3 + mem0 extraction | WORM + soft memory |
| LangGraph state | Postgres checkpointer | Native |

### 11.5 Integration

Pre-turn: retrieve user + agent memories, merge + rerank top-5, inject into system prompt.
Post-turn: `asyncio.create_task(mem0.add(...))` — never block the response.
Decision-time: pull user-preferences memories scoped to the CEO before generating a TradeIntent.

### 11.6 Concrete examples of what an Agent remembers

- "Gregory Shoniwa is CEO of Tendai Capital. Prefers 'Gregory'."
- "Gregory said he doesn't trust Boom 1000 — losing too many times. Don't recommend Boom 1000 strategies."
- "Gregory mentioned ZESA outages 4–8 PM. May not be reachable then."
- "Last week told Gregory that Trendy is on a hot streak — 8/10 wins."
- "Gregory asked twice about voice trading safety. Keep tap-confirm conspicuous."
- "Gregory set Trendy to Sniper personality on 2026-05-25, citing 'too many small losses'."
- "Gregory unlocked Tier 4 (crypto) on 2026-05-22 after Trendy hit 1.4 Sharpe."

### 11.7 Cost

mem0 calls an LLM per `add()` for fact extraction. Use **Groq Llama-3.1-8B** ($0.05/M in + $0.08/M out, ~6.8K tokens/call) → ~$30/mo at 200 users × 10 turns/day. Async (fire-and-forget) so it never blocks chat.

### 11.8 TTL / GDPR

OSS lacks TTL — nightly cron: `DELETE WHERE created_at < NOW() - INTERVAL '2 years'`.
GDPR delete: `mem0.delete_all(user_id=...)` in one call.

---

## 12. Conversational Interface — Chat + Voice

### 12.1 Text chat

Per Agent. Each conversation has Agent's prompt + last 20 decisions + mem0 recall + tool access.

Tools (read-only default): `get_pnl`, `get_recent_trades`, `get_forecast`, `get_agent_performance`, `get_memory`, **`get_calendar`** (v0.5), **`get_personality_radar`** (v0.5), **`get_tier_status`** (v0.5).

User can ask:
- "What's my P&L?"
- "Why did you skip the trade at 09:15?" → Agent: "There was a US NFP release in 8 minutes — event blackout."
- "Show me Trendy's personality vs Rev's."
- "Are we eligible to unlock Tier 4 yet?"
- "Pause trading for the next hour" (admin + confirm)

### 12.2 Voice — Gemini Live API

GA May 2026. ~$0.023/min. Native tool calling. ~400-700ms voice-to-voice.

Constraints: 15-min session cap → resumption tokens · 3 concurrent per key → multi-key at scale · 16kHz PCM · ~80 KB/s bandwidth · Shona not supported (English-first, banner explains).

### 12.3 Voice architecture

```
Browser (getUserMedia + AudioWorklet) → WSS PCM16 → Gateway → Voice Bridge (FastAPI + google-genai) → Gemini Live WSS
                                                                       ↓
                                                          Tool calls (Risk Agent + tap-confirm)
                                                                       ↓
                                                          S3 audit + mem0 extraction
```

### 12.4 Voice safety hard rules

1. Voice cannot bypass Risk Agent.
2. Kill switch voice-deaf (voice requests; WebAuthn arms).
3. Two-channel confirmation for orders (voice → UI tap).
4. Read-only voice default; opt-in to "voice can suggest trades."
5. Audit every utterance.
6. Panic detection: "sell everything NOW" → 10-second confirmation.
7. Voice biometric alone NOT sufficient for trade auth.

---

## 13. Real-Money Enhancements

### 13.1 Kelly-criterion position sizing

`f* = (b·p − q) / b`. Fractional Kelly (default 0.25). Personality preset overrides default.

### 13.2 Performance attribution

Every dollar of P&L decomposed by Agent / strategy / asset / regime / event-window / slippage. Dashboards (§25.2) make "we're up $200" mean something.

### 13.3 Auto-deactivation

Agent Sharpe < 0 over 20+ trades → auto-pause + admin WebAuthn-confirm reactivation.

### 13.4 Continuous learning + drift

Daily Evidently report · weekly Optuna sweep · concept-drift alarm reduces sizing to 25% in unseen regimes · walk-forward strategy hyperparameter optimization.

### 13.5 Profit sweep & insurance fund

Above baseline `+$X` → sweep 30% to "savings" ledger (untouchable by Agents). Insurance fund target 10%. User manually transfers back if they want it re-risked.

### 13.6 Greed limit & cooling-off

3 consecutive wins same asset/strategy → 30-min cool-down (overconfidence).
3 consecutive losses → 30-min cool-down (revenge-trade).
Daily +10% → 50% sizing for rest of day.
Daily -3% → 25% sizing; -5% → halt + auto-flatten.

### 13.7 Smart execution

VWAP slicing for larger orders · slippage budget (cancel if mid moves >2σ) · tick-timing optimization · optional RL execution agent (PPO) Phase 7+.

### 13.8 More signal sources (free)

Volume profile · order-flow imbalance proxy · VWAP distance · funding rates (crypto) · cross-asset correlations · sentiment momentum · implied vol (where available) · retail positioning proxy.

### 13.9 Strategy discovery

Optuna per (strategy × asset × Agent) · walk-forward optimization · A/B testing in shadow mode · Phase 8+ genetic strategy generation.

### 13.10 Edge measurement

Daily Edge Report: Sharpe · win rate vs binomial expected · Information Coefficient · slippage-vs-backtest. Detect edge decay **before** the account dies.

### 13.11 Trade Postmortem (per-trade analysis report)

Every closed trade auto-generates a structured postmortem the CEO can read in plain language. This is what makes the AI auditable — and is the primary input to **employee ratings** (§13.12) and the **learning loop** (§7.5/§10).

Postmortems are generated by the **Postmortem Worker** consuming `trades.executed.{company}` events and writing to `trade_postmortems` in Postgres + the audit log.

**Schema:**

```sql
CREATE TABLE trade_postmortems (
  id UUID PRIMARY KEY,
  trade_id UUID REFERENCES trades(id) UNIQUE,
  company_id UUID NOT NULL,
  agent_id UUID NOT NULL,                  -- the Manager who decided
  strategy TEXT,
  asset TEXT,
  contract_type TEXT,
  outcome TEXT,                            -- 'win' | 'loss' | 'break_even'
  pnl_usd NUMERIC(18,2),

  -- Entry decision trace
  entry_trace JSONB NOT NULL,              -- see structure below
  entry_confidence NUMERIC(5,4),           -- 0-1, manager's confidence at entry
  entry_event_context JSONB,               -- calendar state at entry

  -- Exit decision trace
  exit_trace JSONB NOT NULL,
  exit_trigger TEXT,                       -- 'take_profit'|'stop_loss'|'time'|'manual'|'kill'|'event_blackout'
  mfe_pct NUMERIC(8,4),                    -- max favorable excursion
  mae_pct NUMERIC(8,4),                    -- max adverse excursion
  capture_ratio NUMERIC(5,4),              -- pnl / mfe — did we exit well?

  -- Employee ratings for this trade (§13.12)
  employee_ratings JSONB NOT NULL,         -- one entry per Employee Agent

  -- Plain-language summary for CEO
  narrative TEXT NOT NULL,                 -- LLM-generated, audit-trail-cited
  generated_at TIMESTAMPTZ DEFAULT now()
);
```

**`entry_trace` structure** — every input that fed the decision:

```json
{
  "tsfm_forecasts": [
    {"model": "kronos-small", "direction": "up", "p50": 312.8, "p10": 311.2, "p90": 314.4, "confidence": 0.81, "latency_ms": 47},
    {"model": "timesfm-2.5", "direction": "up", "p50": 312.6, "p10": 311.0, "p90": 314.0, "confidence": 0.74},
    ...
  ],
  "strategy_rules_evaluated": {
    "trend_following": {"fired": true, "ema50_gt_ema200": true, "adx_14": 31, "macd_flip": true},
    "breakout": {"fired": false, "reason": "no recent level break"},
    ...
  },
  "employee_opinions": [
    {"agent_id": "agt_trendy", "verdict": "BUY", "confidence": 0.78, "expected_value_usd": 4.20,
     "rationale": "EMA50>EMA200, ADX=31, 4/5 TSFMs agree.",
     "supporting_models": ["kronos-small","timesfm-2.5","chronos-bolt-small","fincast"],
     "dissenting_models": ["ttm"]},
    {"agent_id": "agt_brakey", "verdict": "HOLD", "confidence": 0.42, "rationale": "no breakout setup"},
    ...
  ],
  "research_brief": {
    "polymarket_signals": {"pm_fed_cut_25_next": 0.32},
    "news_sentiment": 0.14,
    "calendar": "next high-impact event in 4hr 12min (US PPI) — clear"
  },
  "memory_recall": [
    {"mem_id": "mem_2026_05_19_a", "summary": "Similar setup 7d ago: WIN +$2.10 in 18min", "similarity": 0.87},
    {"mem_id": "mem_2026_05_12_b", "summary": "Similar setup 14d ago: LOSS -$1.40, ADX faded", "similarity": 0.79},
    ...
  ],
  "personality_filter": {
    "personality": "balanced",
    "trade_selection_mode": "most_profitable",
    "kelly_fraction": 0.25,
    "kelly_suggested_stake": 7.20,
    "min_confidence_required": 0.60,
    "max_trades_remaining_today": 8
  },
  "manager_synthesis": {
    "chosen_employee": "agt_trendy",
    "vs_alternatives": [
      {"agent_id": "agt_action", "verdict": "BUY", "rejected_because": "lower EV"},
      {"agent_id": "agt_rev", "verdict": "HOLD", "rejected_because": "no mean-rev setup"}
    ],
    "final_confidence": 0.74,
    "rationale": "Trend agent has highest EV ($4.20) and agrees with 4/5 models. Memory shows 4 of 5 similar setups won. Manager confidence 0.74."
  },
  "risk_validation": {
    "limits_ok": true, "slippage_budget_ok": true,
    "event_blackout_ok": true, "tier_ok": true,
    "kelly_sized_stake_usd": 7.20, "capped_to": 10.00
  },
  "tier_context": {"current_tier": 2, "asset_allowed": true, "contract_allowed": "MULTUP"}
}
```

**`exit_trace` structure:**

```json
{
  "trigger": "take_profit",
  "trigger_ts": 1748285520,
  "holding_secs": 720,
  "entry_price": 312.4,
  "exit_price": 318.8,
  "tp_target": 318.8,
  "sl_target": 309.2,
  "tsfm_forecasts_at_exit": [
    {"model": "kronos-small", "direction": "up", "p50": 319.2, "confidence": 0.62}
  ],
  "intermediate_decisions": [
    {"ts": ..., "type": "no-action", "reason": "still above entry + bands intact"},
    {"ts": ..., "type": "tp-hit", "reason": "price touched take_profit"}
  ],
  "exit_quality": {
    "captured_pct_of_mfe": 0.94,
    "max_favorable_excursion_pct": 1.49,
    "max_adverse_excursion_pct": -0.21,
    "could_have_exited_better_by_usd": 0.30,
    "verdict": "good_exit"
  }
}
```

**`narrative`** — an LLM (Claude Haiku, cheap) generates a 2–4 paragraph plain-language summary from the above:

> "On 26 May at 11:43 SAST, Trendy initiated a long Multiplier on 1HZ100V at 312.40, staking $10. The decision was driven by a confluence of signals: EMA50 was above EMA200 with ADX at 31 (clear trend), and four of five forecasting models projected upward movement with median 312.8 and tight uncertainty bands. The only dissenter was TTM (confidence 0.52), but its forecast was flat rather than directional.
>
> Memory recall showed 4 of 5 similar setups this month closed profitably, with average gain $2.10. Alpha (manager) selected Trendy over Action because expected value was higher ($4.20 vs $2.80). Kelly-criterion sizing suggested $7.20, capped at user's $10 maximum. No economic events were within blackout range — next high-impact event (US PPI) was 4 hours out.
>
> The trade closed at 318.80 (target hit) after 12 minutes. Max favorable excursion was $0.04 above the target, so capture was 94% — a clean exit. Net P&L: +$2.00 after spread and slippage."

**UI display** — the Trade Postmortem panel (§20.13) shows the narrative on top and the structured trace as collapsible sections beneath. CEO can drill into any field. Voice-chat with the Agent can reference this trace: "Tendai, why did you take that trade?" → Agent reads from the postmortem narrative.

**Cost:** narrative generation is ~$0.0003 per trade with Haiku. 200 users × 20 trades/day = ~$36/mo at full scale. Acceptable.

### 13.12 Employee Rating per trade

Every trade rates every active Employee Agent — even those who voted HOLD. Ratings feed the agent leaderboard and learning loop.

**Three rating dimensions per Employee per trade:**

1. **Direction Score** — did this Employee's `verdict` match the trade's actual outcome direction?
   - Voted BUY, trade was a win → +1.0
   - Voted BUY, trade was a loss → -1.0
   - Voted SELL, trade was a loss for the BUY direction → +0.5 (correctly dissented)
   - Voted HOLD when trade won → -0.3 (missed opportunity)
   - Voted HOLD when trade lost → +0.5 (correctly avoided)

2. **Calibration Score** — was the Employee's stated `confidence` honest?
   - Brier-score-style: `1 - (confidence - outcome_indicator)²`
   - High confidence + right = high calibration
   - High confidence + wrong = penalized
   - Low confidence + right = neutral
   - Low confidence + wrong = neutral

3. **Information Value (IV) Score** — did this Employee actually change the manager's decision?
   - Run a counterfactual: would the manager have made the same decision *without* this Employee's opinion?
   - If yes (Employee redundant): IV = 0
   - If no, and the change improved outcome: IV = +1.0
   - If no, and the change worsened outcome: IV = -1.0

   Counterfactual is cheap to compute: re-run the manager's decision logic with the Employee's signal removed; compare verdicts. Done in <50ms per Employee.

**Composite rating per trade:**

```
composite_rating = 0.4 * direction_score
                 + 0.3 * calibration_score
                 + 0.3 * information_value_score
                 → scaled to [-1, +1]
```

**Aggregation over time:**

Per Employee, rolling windows of 30, 90, 365 trades. Stored in `agents.performance_stats`:

```json
{
  "ratings_30d": {
    "trades_evaluated": 42,
    "avg_composite_rating": 0.34,
    "avg_direction_score": 0.41,
    "avg_calibration_score": 0.28,
    "avg_information_value": 0.33,
    "rating_trend": "improving",
    "rank_in_company": 2
  },
  "ratings_by_regime": {
    "trending_high_vol": 0.52,
    "ranging_low_vol": 0.08,
    ...
  },
  "ratings_by_asset": {
    "1HZ100V": 0.61,
    "EUR/USD": 0.22,
    ...
  }
}
```

**Surfacing in UI:**

- **Agent card** shows `★★★★☆ 0.34` rating (30d), color-graded
- **Agent profile** shows rating trend chart + rating by regime/asset
- **Company leaderboard** ranks Employees by composite rating
- **Postmortem panel** shows each Employee's rating for the *specific* trade

**Auto-actions triggered by ratings:**

- Employee composite rating < -0.2 over 30 trades → flag for review
- Employee Information Value ≈ 0 for 60 trades → "this Employee is redundant; consider removing or re-roling"
- Best-rated Employee per regime gets sizing boost (5–10%) — performance-weighted ensembling
- Worst-rated Employee per regime gets sizing penalty (5–10%) before auto-pause kicks in

**Anti-gaming:**

The ratings only count Employees that were *active* on the trade — if an Employee was disabled for an asset, it doesn't get rated on it. Employees can't game by abstaining: HOLD votes are rated against the trade's actual outcome.

**Cost:** ratings computation is deterministic Python (no LLM). Free aside from compute. The counterfactual re-run is the most expensive piece (~50ms × N employees per trade).

### 13.13 Closing the learning loop

Every postmortem also flows into:

- **mem0** as a procedural memory: "When I see this setup again, here's what happened last time"
- **Postgres outcome embedding table** for next decision's outcome-recall (§10.3 item 9)
- **Weekly lesson distillation** (§7.5) — clusters postmortems by regime, asks LLM "what separated wins from losses?"
- **Per-Agent XGBoost regression head** retraining input
- **Aggression Index recompute** (§7.5)
- **Tier eligibility re-check** (§8.2)

So a single postmortem isn't just a report — it's the input that updates 6 different downstream systems. The CEO sees the report; the AI gets smarter.

---

## 14. Hardware Tiers & Local Development

| Tier | Hardware | TSFMs | LLM | Voice |
|---|---|---|---|---|
| **Lean Local** | M1 8GB | TTM, Kronos-small/base, Chronos-Bolt-small, TimesFM 2.5 | Cloud Gemini Flash | Cloud Gemini Live |
| **Local Pro** | M3 Ultra 64GB / RTX 4090 24GB | + Chronos-2 | Local 7B–13B | Cloud |
| **Cloud Standard** | 1–2× L40S 48GB | All 5 incl. FinCast 1B | Cloud | Cloud |
| **Cloud High** | 4–8× L40S/H100 | All 5 + diversifiers + RL exec | Mixed | Cloud (multi-key) |

**M1 Docker CPU latencies:** TTM ~10ms · Kronos-small ~50ms · Chronos-Bolt-small ~40ms · Kronos-base ~200ms · TimesFM 2.5 ~300ms. Total cycle <500ms. Fine for dev. `make dev-mps` runs TSFMs natively for MPS acceleration.

---

## 15. Training Data & External Signal Sources

### 15.1 Price history

| Asset | Source | Free? |
|---|---|---|
| Deriv synthetics | Deriv `ticks_history` paginated | ✓ |
| Forex | Dukascopy tick from 2003 (`dukascopy-node`) | ✓ |
| Forex backup | HistData.com 1-min | ✓ |
| Crypto | Binance `data.binance.vision` monthly dumps | ✓ |
| Paid all-in-one | EODHD $99/mo or Polygon $79/mo | $ |

### 15.2 Polymarket — runtime signal, not training data

Bounded probability collapsing to 0/1 — wrong distribution for OHLC TSFMs. Used as exogenous covariate channel only.

### 15.3 Sentiment + event sources (all free)

| Source | Use |
|---|---|
| **Finnhub** | News + sentiment (60 req/min free) |
| **GDELT 2.0** | Global event DB, tone-scored, BigQuery |
| **Kalshi** | CFTC-regulated prediction markets — Fed, CPI, elections |
| **Polymarket** | Political / geopolitical (read-only) |
| **Manifold** | Play-money signal diversity |
| **Forex Factory** | Economic calendar (scrape via Apify) |
| **Reddit (PRAW)** | Retail sentiment |
| **Binance funding rates** | Crypto perps reversal signal |

### 15.4 Don't use

Alpha Vantage (25 req/day free — dead), CoinGecko (daily only), Yahoo for training depth, NewsAPI (dev-only license).

### 15.5 Pretraining corpora — skip; fine-tune instead.

---

## 16. Training & Fine-Tuning the Models

### 16.1 Zero-shot first

Don't fine-tune in Phase 1. Measure 14 days per asset zero-shot. Only fine-tune where it pays back.

### 16.2 Fine-tune recipes

| Model | Hardware | Time |
|---|---|---|
| TTM granite-r2 | M1 CPU | 10–30 min/asset |
| Kronos-small | M1 CPU | hours |
| Kronos-base | Cloud GPU (T4/A10G) | 2–4 hr |
| TimesFM 2.5 | Cloud GPU | 4–8 hr |
| Chronos-Bolt-small | M1 CPU | 2–4 hr |
| Chronos-2 | Cloud GPU | hours |
| FinCast 1B | Multi-hour GPU | Skip v1 |

### 16.3 Promotion gate

Walk-forward 6m/1m × 6 folds · ≥5% MASE gain · 7d shadow · WebAuthn admin approval.

### 16.4 LLM "training" recap

Prompt engineering · tool schemas · few-shot · mem0 memory · weekly lesson distillation · per-Agent XGBoost regression head (Phase 5+) · optional provider fine-tune (rarely worth it).

---

## 17. Deriv Integration — Full Contract Registry

### 17.1 Zimbabwe support

Deriv serves Zimbabwe. Regulator Deriv (BVI) Ltd or Deriv (V) Ltd typically. All synthetics + forex + crypto + commodities available.

### 17.2 Payment & internet resilience

| Method | Use |
|---|---|
| Crypto deposit (USDT TRC-20, USDC) | Primary |
| Skrill / Neteller | Common |
| EcoCash | Indirect via Yellow Card / Binance P2P |
| Bank wire (USD) | Backup |
| Visa/Mastercard | Last resort |

Reconnect-with-seq-resume · Lite mode for slow connections · service worker offline · auto-flatten on extended disconnect (configurable).

### 17.3 Connection

`wss://ws.derivws.com/websockets/v3?app_id=<APP_ID>` · per-Company API token → `{"authorize": "<token>"}`. `python-deriv-api` archived March 2026 → Go client in gateway.

### 17.4 Rate limits

180 general/min · 80 pricing/min · 25 outcome/min · 5 concurrent `proposal`. Shard across parallel WSS.

### 17.5 Markets — full coverage

| Market | Examples | Tier (§8) |
|---|---|---|
| Forex Majors | EUR/USD, GBP/USD, USD/JPY, USD/CHF | 1 |
| Forex Minors | EUR/GBP, AUD/JPY, EUR/CHF, GBP/AUD | 3 |
| Forex Exotics | USD/TRY, USD/MXN, USD/ZAR, USD/CNH | 3 |
| Synthetic Indices — Vol | R_10, R_25, R_50, R_75, R_100, 1HZ10V, 1HZ100V, 1HZ150V, 1HZ200V, 1HZ250V | 2 |
| Synthetic Indices — Crash/Boom | Crash 300/500/1000, Boom 300/500/1000 | 5 |
| Synthetic Indices — Jump | Jump 10/25/50/75/100 | 5 |
| Synthetic Indices — Step, Range Break | Step Index, Range Break 100, Range Break 200, Daily Reset | 9 |
| Commodities | XAU/USD, XAG/USD, oil | 3 |
| Stock Indices | US500, US Tech 100, Wall Street 30, Germany 40 | 6 |
| Cryptocurrencies | BTC/USD, ETH/USD, LTC/USD, XRP/USD | 4 |
| Basket Indices | AUD basket, EUR basket, GBP basket, USD basket | 6 |

### 17.6 Contract Type Plugin Registry

Every contract type is a Python plugin implementing this interface:

```python
class ContractPlugin(Protocol):
    code: str                              # "MULTUP", "ACCU", "TURBOSLONG", ...
    display_name: str
    tier: int                              # min tier required (§8)
    risk_class: str                        # "linear", "capped", "leveraged", "binary"
    supports_strategies: list[str]         # ["trend","mean_reversion",...]
    requires_features: list[str]           # e.g. "barrier", "duration", "multiplier"

    def build_proposal(self, params: ContractParams) -> dict:
        """Return the Deriv WS proposal payload."""
    def build_buy(self, proposal_id: str, price: float) -> dict:
        """Return the buy payload."""
    def build_sell(self, contract_id: str) -> dict:
        """Return the sell-early payload."""
    def map_strategy_signal(self, signal: StrategySignal) -> ContractParams:
        """Translate a StrategySignal to this contract's parameters."""
    def estimate_payoff(self, params: ContractParams,
                        forecast: Forecast) -> EVEstimate:
        """Compute win_probability, payoff_ratio, expected_value."""
```

### 17.7 Registered contract types (v1 ships Tiers 1–4; rest progressively)

| Code | Display | Tier | Risk class |
|---|---|---|---|
| MULTUP / MULTDOWN | Multipliers | 1 | leveraged-capped |
| ACCU | Accumulators | 2 | growing-stake |
| TURBOSLONG / TURBOSSHORT | Turbos | 5 | knockout-directional |
| VANILLALONGCALL / VANILLALONGPUT | Vanilla Options | 7 | option |
| CALL / PUT | Rise/Fall (classic binary) | 8 | binary |
| HIGHER / LOWER | Higher/Lower | 8 | binary-with-barrier |
| ONETOUCH / NOTOUCH | Touch / No Touch | 8 | barrier-binary |
| ENDSBETWEEN / ENDSOUTSIDE | In / Out (ends) | 8 | range-binary |
| STAYSBETWEEN / GOESOUTSIDE | Stays / Goes (in-range) | 8 | range-binary |
| ASIANU / ASIAND | Asians | 9 | asian-binary |
| DIGITMATCH / DIGITDIFF / DIGITOVER / DIGITUNDER / DIGITEVEN / DIGITODD | Digits | 9 | digit-binary |
| RESETCALL / RESETPUT | Reset Call/Put | 9 | reset-binary |
| TICKHIGH / TICKLOW | High/Low Tick | 9 | tick-binary |

### 17.8 Adding a new contract type

The plugin registry pattern means adding new Deriv contracts requires no agent / strategy / risk-engine changes. Steps:

1. Create `services/contracts/plugins/{contract_code}.py` implementing `ContractPlugin`
2. Register via `@register_contract`
3. Add risk parameter mapping in `services/risk/contract_risk.py`
4. Add to a tier in §8 mapping
5. Test in paper mode

Strategy Agents call `registry.get_contracts_for(strategy, asset)` to enumerate options.

### 17.9 Demo vs live + paper-trade gate

Every Deriv account ships with Virtual ($10k synthetic USD). 14-day paper gate + risk disclosures + WebAuthn before live unlock.

### 17.10 Sample buy flow (MULTUP)

```jsonc
{"authorize": "TOKEN"}
{"proposal": 1, "amount": 10, "basis": "stake",
 "contract_type": "MULTUP", "currency": "USD",
 "duration_unit": "s", "multiplier": 10,
 "symbol": "1HZ100V", "subscribe": 1, "req_id": 42}
{"buy": "<proposal.id>", "price": 10, "req_id": 43}
{"sell": <contract_id>, "price": 0}
```

### 17.11 Compliance

Self-attestation jurisdiction · "Not financial advice" banner (Shona + English) · gambling-regulator disclosure · ZIMRA tax note · per-tier risk disclosures.

---

## 18. Data Pipeline & Features

### 18.1 Stores

QuestDB ticks/candles/calendar · Postgres+pgvector multi-tenant/audit/mem0/outcomes · Redis hot ticks/sessions/approval queue/event blackout state · S3 audit + voice WORM.

### 18.2 Streaming features (no look-ahead)

Returns/range/wicks · volume z-score + OBV + **volume profile** · EMA 9/21/50/200 · MACD · ADX · ATR · BB · RSI · Stoch · ROC · S/R · pivots · Hurst · OU half-life · price-action flags · bid-ask · tick rate · **VWAP** · **OFI proxy** · **funding rate** (crypto) · **cross-asset correlations** · Polymarket/Kalshi channels · **economic-calendar countdowns** (`time_to_next_event`, `event_impact_score`) · session tags · time-of-day cyclical.

### 18.3 Look-ahead prevention

Purged k-fold + embargo · asof-rule enforced · survivorship check.

---

## 19. Backend Stack

| Layer | Choice |
|---|---|
| WS Gateway + Order Router + Voice Bridge | Go (Fiber + nhooyr/websocket) |
| REST + Features + Backtest + Agent Mgmt | FastAPI (Python 3.12) |
| Agent Orchestration | LangGraph 0.3+ |
| Voice Bridge | FastAPI + `google-genai` |
| Memory | mem0 (embedded library, pgvector backend) |
| Model Serving (local) | FastAPI + Pydantic |
| Model Serving (cloud) | BentoML 1.3+ |
| LLM | Pluggable adapter |
| Streaming Bus | NATS JetStream |
| Time-Series DB | QuestDB 8+ |
| OLTP + Vector | Postgres 17 + pgvector 0.9 |
| Cache | Redis 7.4 |
| Calendar ingestor | FastAPI cron service |
| Tier manager | FastAPI |
| Personality detector | Python cron |
| Performance attribution | FastAPI |
| Auto-pauser | Python cron |
| RL execution (Phase 7+) | Stable-Baselines3 / Ray RLlib |

### 19.1 NATS subjects (with v0.5 additions)

```
ticks.{symbol}                  candles.{symbol}.{tf}
features.{symbol}               signals.{model}.{symbol}
events.calendar.{country}       events.affected.{asset}    -- v0.5
decisions.strategy.{company}    decisions.manager.{company}
trades.intent.{company}         trades.approved.{company}
trades.approved.user.{company}  trades.executed.{company}
trades.rejected.{company}       trades.blocked.event.{company}  -- v0.5
voice.session.{company}         learn.outcome.{company}
perf.attribution.{company}      auto_pause.{company}
tier.unlock.{company}           tier.eligible.{company}    -- v0.5
audit.>                         sys.kill_switch.{company}
```

### 19.2 API surface (selected v0.5 additions)

```
GET    /api/v1/companies/{id}/calendar?from=&to=
GET    /api/v1/companies/{id}/events/affected/{asset}
GET    /api/v1/companies/{id}/agents/{aid}/personality   -- radar data
PATCH  /api/v1/companies/{id}/agents/{aid}/personality
GET    /api/v1/companies/{id}/tier-status                -- current tier + eligibility
POST   /api/v1/companies/{id}/tier-unlock/{tier}         -- requires WebAuthn
GET    /api/v1/companies/{id}/agents/{aid}/aggression-index
GET    /api/v1/companies/{id}/contract-types             -- enabled per Company
```

All routes scoped by `company_id`. Row-level security backs it up.

---

## 20. Frontend & Dashboard — Design Language

### 20.1 Inspiration

LITTLEBEE: dark navy/black canvas (`#0B0E14`), bright **lime green** primary accent (`#A8FF35`), card-heavy layout, hero chart with green glow, monospace numbers, world-map session widget, position-size calculator, economic-events list with country flags.

### 20.2 Top-nav

```
┌───────────────────────────────────────────────────────────────────────┐
│  [TM logo] [Company ▾] [Avatar: Gregory ▾]                            │
│                        [Fiat $2,000 ▲20%] [Trading $2,999 ▼5%]        │
│                                            [🔔] [Deposit ↓]            │
└───────────────────────────────────────────────────────────────────────┘
```

### 20.3 Sidebar

```
COMPANY: Tendai Capital ▾
─────────────────────────
[ Market | Trades ]
🏠 Discover
📊 Live Trading
🤖 Agents (8)
   ├ Alpha (Manager)
   ├ Trendy ⚡ Sniper
   ├ Brakey 🎯 Hunter
   ├ Rocky 🛡 Guardian
   ├ Rev ⚖ Balanced
   ├ Action 🔁 Scalper
   ├ Scout (Research)
📈 Models & Forecasts
🔬 Edge Report
🪜 Asset Tiers (Tier 2/9)   ← v0.5
📅 Economic Calendar
⏱ Approvals (3)
💬 Conversations
📜 Trades & Audit
💰 Profit Sweep
⚙ Settings
─────────────────────────
[ Mode: ●●● Paper | Live ]
[ KILL SWITCH ⏸ ]
```

### 20.4 Discover (default workspace)

```
┌──────────────────────────────────────────────────┬─────────────────┐
│  BALANCE                       6 Month ▾         │  POSITION SIZE  │
│  $4,999.95  ▲ 20%                                │  CALCULATOR     │
│  ╱═══════════════════════════╗  $36,126 peak    │  ...             │
│  (chart with green glow)     ║                  │  [ Calculate ]  │
├──────────────────────────────────────────────────┤                 │
│  MANAGER ALPHA · current verdict                 │  Units: 2 753   │
│  ▲ BUY MULTUP 1HZ100V · $10 · conf 0.74          │                 │
│  "EMA50>200, ADX=31, 4/5 TSFMs agree..."         │                 │
│  ⚠ US NFP in 11min · USD pairs blacked out       │   ← v0.5 banner  │
│  [ Approve ] [ Reject ]   28s ⏱                  │                 │
└──────────────────────────────────────────────────┴─────────────────┘
┌────────────┬─────────────┬────────────┬───────────────────────────┐
│ EDGE       │ ECONOMIC    │ MARKETS    │ MARKET HOURS              │
│ Sharpe 1.82│ EVENTS      │            │  Globe with NY/London/    │
│ WR 64%     │ Fri Jun 20  │ BTC/USDT   │  Tokyo/CAT indicators     │
│ 142 trades │ 🇺🇸 NFP 14:30 HIGH│ ETH/USDT  │                           │
│ DD 4.2%    │ 🇬🇧 PPI ↓.3% │ EUR/USD    │  Now: 11:24 CAT          │
│ +$847      │ 🇯🇵 PPI ↓.3% │ XAU/USD    │                           │
│ [Detail→]  │ [All→]      │ ...        │                           │
└────────────┴─────────────┴────────────┴───────────────────────────┘
```

### 20.5 Agents page

5-per-row grid of cards. Each card shows: avatar · name · role · personality icon · LLM · alloc · today's P&L · win rate · Sharpe · aggression badge · [💬 Chat] [🎙️ Voice] [⚙ Configure].

### 20.6 Agent profile (clicking a card)

```
┌──────────────────────────────────────────────────────────┐
│  [avatar] ALPHA · Manager                  [Configure ⚙] │
│           Claude Sonnet · Voice: Aoede                   │
│           Personality: BALANCED ⚖                        │
│           Detected: Slightly Aggressive (62/100)         │
│           Trade Mode: most_profitable                    │
│           Tier: 2 (Forex Majors + Synthetic Indices)     │
├──────────────────────────────────────────────────────────┤
│  RADAR                          PERFORMANCE              │
│        Risk Appetite            Win 64% · 142 trades     │
│       ╱        ╲                Sharpe 30d: 1.82         │
│  Recov          Freq            Net: +$847.20            │
│   │      ●      │               Alloc: $200/$500         │
│  Conf          Hold             Kelly: 0.25              │
│       ╲        ╱                                          │
│      Diversification                                      │
├──────────────────────────────────────────────────────────┤
│  [💬 Chat]   [🎙️ Voice]   [📜 Decisions]   [🧠 Memory]   │
├──────────────────────────────────────────────────────────┤
│  ATTRIBUTION                                              │
│  • By strategy:  Trend +$430 · MeanRev +$180 · ...       │
│  • By asset:     1HZ100V +$520 · EUR/USD +$200 · ...     │
│  • By regime:    trending +$640 · ranging +$200          │
│  • By event-window: clear +$700 · pre-NFP -$53           │
├──────────────────────────────────────────────────────────┤
│  RECENT DECISIONS                                         │
│  → 11:43 · BUY MULTUP 1HZ100V $10 · pending             │
│  → 11:31 · HOLD GBP/USD (pre-event blackout)            │
│  → 11:20 · SELL MULTDOWN R_75 $5 · WIN +$1.2            │
└──────────────────────────────────────────────────────────┘
```

The radar chart visualizes the Aggression Index across 6 axes.

### 20.7 Configure Agent form

Tabs:
1. **Identity** — name, avatar, voice
2. **Brain** — LLM provider/model/temperature/system prompt addendum
3. **Personality** — preset picker (Sniper/Scalper/Hunter/Guardian/Balanced/Custom) + parameter sliders
4. **Trade Selection** — radio (specific / most-profitable / safest / balanced) + whitelist editor if specific
5. **Assets & Contracts** — checkbox grid of unlocked assets × contract types
6. **Capital** — allocation slider, max position, DD cap, Kelly fraction
7. **Behavior** — trade mode (autonomous/approve/threshold), event-aware toggle
8. **Hierarchy** — reports_to
9. **Status** — active/paused

### 20.8 Tier Map screen

```
ASSET TIER PROGRESSION                  Currently: Tier 2 of 9

[✅ Tier 1] Forex Majors                     ACTIVE
[✅ Tier 2] + Synthetic Indices              ACTIVE
[🔓 Tier 3] + Forex Minors + Commodities     ELIGIBLE
         Last 30 days at Tier 2: 52 trades · Sharpe 1.62 · DD 3.8%
         [ Unlock Tier 3 → ]   (WebAuthn required)
[🔒 Tier 4] + Crypto                          LOCKED
         Need: Tier 3 active for 30 days first
[🔒 Tier 5] + Crash/Boom + Turbos             LOCKED
[🔒 Tier 6] + Stock Indices                   LOCKED
[🔒 Tier 7] + Vanilla Options                 LOCKED
[🔒 Tier 8] + Higher/Lower + Touch/No Touch   LOCKED
[🔒 Tier 9] + Specialized (Digits, Asians,    LOCKED
            Reset, Tick Highlow, Range,
            Step, Daily Reset)
```

### 20.9 Approval modal (approve-each mode)

Adds v0.5 event-aware row:

```
APPROVE TRADE — 28s ⏱
Agent: Trendy (Sniper · Trend Following)
BUY · MULTUP · 1HZ100V
Stake: $10 · Mult: 10× · SL: $8 · TP: $14 (payoff 2.0×)
Kelly suggests $7.20; capped to your $10 max.
Event status: CLEAR (next NFP in 11min — synthetic indices unaffected)
Trade selection: most_profitable · EV +$3.40

Rationale: "..."

[KR ▲.81][TF ▲.74][CH ▲.68][FC ▲.71][TT ●.52]
[ EDIT SIZE ]  [ REJECT ]  [ APPROVE ⏱ ]
```

### 20.10 Voice call modal

Avatar pulsing · live waveform · transcript · `time used / time cap` · data used (ZW data-cost-aware) · [🔇 Mute] [End Call].

### 20.11 Mobile-first (ZW)

Breakpoints to 360px · service worker offline · Lite mode auto on slow connections · Web Push · WhatsApp share · voice data-usage warning.

### 20.12 Day-one widget list

Balance pills + Deposit · hero balance chart (green glow) · Position Size Calc · Manager Verdict (with event banner) · Edge Report · Economic Events · Markets mini-list · Market Hours globe · Agent Gallery · Approval Modal · Voice Modal · Kill Switch · Mode Indicator · Trade Mode Toggle · Profit Sweep · Agent Profile with **Radar** · **Tier Map** · Attribution breakdown · Strategy Verdict cards (5) · Decisions Log · Model confidence bands · Risk Panel · **Trade Postmortem panel** (v0.5.1) · **Employee Leaderboard** (v0.5.1).

### 20.13 Trade Postmortem panel

Opens when CEO clicks any closed trade. Top: LLM-generated 2–4 paragraph narrative. Below: collapsible structured sections:

```
┌──────────────────────────────────────────────────────────────────┐
│  TRADE POSTMORTEM — 26 May 11:43–11:55 SAST                       │
│  BUY MULTUP 1HZ100V · $10 · WIN +$2.00 · held 12min · ★★★★☆      │
├──────────────────────────────────────────────────────────────────┤
│  NARRATIVE                                                        │
│  "On 26 May at 11:43, Trendy initiated a long Multiplier on       │
│   1HZ100V at 312.40, staking $10. The decision was driven by      │
│   a confluence: EMA50 above EMA200 with ADX 31, and 4 of 5 models │
│   projected up. Memory recall showed 4 of 5 similar setups won.   │
│   Manager confidence: 0.74. No event blackout in range."          │
├──────────────────────────────────────────────────────────────────┤
│  ENTRY DECISION TRACE                                  [Expand ▾] │
│   • TSFM Forecasts (5 models, p10/p50/p90 + confidence)           │
│   • Strategy rules evaluated (5 strategies, which fired)          │
│   • Employee opinions (5 votes + rationale each)                  │
│   • Research brief (Polymarket / Kalshi / news / calendar)        │
│   • Memory recall (top-5 similar past trades + outcomes)          │
│   • Personality + trade-selection filter                          │
│   • Manager synthesis (chosen vs alternatives)                    │
│   • Risk validation (limits / slippage / blackout / tier)         │
├──────────────────────────────────────────────────────────────────┤
│  EXIT DECISION TRACE                                   [Expand ▾] │
│   • Trigger: take_profit @ 318.80                                 │
│   • MFE: 1.49% · MAE: -0.21% · Capture: 94%                       │
│   • Intermediate decisions (no-action checkpoints)                │
│   • Verdict: good_exit                                            │
├──────────────────────────────────────────────────────────────────┤
│  EMPLOYEE RATINGS for this trade                                  │
│   Trendy:  ★★★★★ (+0.86)  Direction +1, Calibration .82, IV +1   │
│   Brakey:  ★★★☆☆ (+0.12)  voted HOLD (correct opportunity miss)  │
│   Rocky:   ★★★☆☆ (+0.08)  no opinion (asset not allowed)         │
│   Rev:     ★★☆☆☆ (-0.21)  voted HOLD wrongly                     │
│   Action:  ★★★★☆ (+0.54)  voted BUY but lower EV than Trendy     │
└──────────────────────────────────────────────────────────────────┘
```

### 20.14 Employee Leaderboard

Sortable table per Company showing all Employees ranked by 30-day composite rating, with breakdowns by regime + asset. Color-coded heatmap. Clicking an Employee opens their full profile (§20.6).

---

## 21. Design System

### 21.1 Primary palette — `dark-lime` (LITTLEBEE-inspired)

```css
:root[data-theme="dark-lime"] {
  --bull: #A8FF35;
  --bear: #FF6D5C;
  --neutral: #9CA3AF;
  --hero-glow: radial-gradient(closest-side, rgba(168,255,53,.45), transparent 70%);

  --critical: #E91E63;
  --warning: #FBBF24;
  --info: #60A5FA;
  --success: #A8FF35;

  --bg: #0B0E14;
  --bg-elev-1: #11151E;
  --bg-elev-2: #171C28;
  --bg-card: #14181F;
  --border: #1F2937;
  --text: #E5E7EB;
  --text-dim: #9CA3AF;
  --text-mute: #6B7280;

  --paper-mode: #A8FF35;
  --live-mode: #FF6D00;
}
```

### 21.2 Alternate — `dark-cyan` (CVD-safe)

`--bull: #00B8D4` · `--bear: #FF6D00`. Same surfaces. User toggles in settings. Always pair color with glyph (▲ ▼ ●).

### 21.3 Personality icons

| Personality | Icon |
|---|---|
| Sniper | ⚡ |
| Scalper | 🔁 |
| Hunter | 🎯 |
| Guardian | 🛡 |
| Balanced | ⚖ |
| Custom | ✦ |

### 21.4 Typography

UI: Inter Variable. Numbers: JetBrains Mono Variable (tabular-nums + slashed zero `ss01`).

### 21.5 Density

~65% of Bloomberg. Manager Verdict + P&L + Kill Switch visually dominant.

### 21.6 Motion

Hero chart line draws 600ms · approval countdown ring smooth · voice waveform 30fps · mode-border color fade 300ms.

### 21.7 Brand vs Company customization

Default `dark-lime`. Each Company can override accent color + logo. Agent avatars user-uploaded.

---

## 22. Safety, Risk Controls & Trade Modes

### 22.1 Trade modes

Per-Agent (inherits Company default):

| Mode | Behavior |
|---|---|
| `autonomous` | Manager → Risk → Order Router |
| `approve_each` | Add user Approval Queue (30s default) — **default for new Agents** |
| `approve_above_threshold` | < $X auto; ≥ $X requires approval |

Instant toggle. In-flight respect original mode.

### 22.2 Hard limits (mirrored Go gateway + Risk Agent)

ZW defaults:

- Max position per symbol: $25 absolute, 2% equity
- Max gross exposure: 15% equity
- Max daily DD per Agent: 5% · per Company: 10%
- Max orders/min per Agent: 6 (configurable via personality `max_trades_per_day`)
- Stop-loss required: yes (hardcoded)
- Cool-down after 3 consecutive losses: 30 min
- **Cool-down after 3 consecutive wins**: 30 min
- **Profit sweep above baseline +$X**: 30% to savings
- Auto-flatten at daily DD limit

### 22.3 Pre-trade validation (Risk Agent)

Limits · slippage budget · account state · trade-volume sanity · Kelly sizing check · **event blackout check (§9)** · **tier whitelist check (§8)** · **personality cool-down (max_trades_per_day, target_holding_secs)** · profit-sweep / greed limit. Sign + audit. → approved/rejected.

### 22.4 Circuit breaker

3 consecutive losses → 30-min cool-down · DD ≥80% → 25% sizing · DD ≥100% → halt + flatten + 24h lockout · slippage >2σ on 5 consecutive → halt symbol · model latency p99 >500ms → halt + page · broker disconnect >60s → halt; manual resume · Agent Sharpe <0 over 20+ trades → auto-pause.

### 22.5 Kill switch

Three triggers — user (2-sec hold), ops (CLI/Slack + MFA), automatic (circuit breakers). Per-Company **and** per-Agent. Armed state in Redis AOF + Postgres mirror. Voice-deaf (WebAuthn arms).

### 22.6 Manual override

User manual trade still goes through Risk Agent. Agent layer not notified.

### 22.7 Voice safety (recap)

Voice = UI, never authorization. Risk Agent + kill switch voice-deaf. Tap-confirm + WebAuthn always. Panic detection. Audit every utterance.

### 22.8 Real-money psychology guards

Cooling-off after big win (>2% daily) — 4hr pause · profit sweep · insurance fund target · greed limit after 3 consecutive wins same combo · 30-min revenge-trade cool-down · daily DD ramp-down sizing.

### 22.9 Per-Agent safety scoping

Each Agent: own allocation, position cap, DD limit, kill switch. Company kill switch overrides all.

### 22.10 Event-aware trading blackouts (§9 recap)

Real-world economic events trigger hard pre-/post-event blackouts at Risk Agent level for affected assets. Synthetic indices exempt. CEO can override per-Agent (with stricter sizing penalties).

---

## 23. Backtesting Framework

vectorbt-pro + walk-forward + purged k-fold + embargo. Required metrics: Sharpe · Sortino · Calmar · max DD · time-under-water · hit rate · profit factor · **Deflated Sharpe** · slippage-adjusted P&L · **Information Coefficient**.

Stress tests: vol-regime · liquidity (2× spread + 50ms latency) · drawdown · adversarial replay (worst 50 hours) · regime-shift simulation · **event-window stress** (simulate trading through NFP/FOMC) (v0.5).

Promotion gate per (strategy × asset × Agent × tier): Walk-forward 6m/1m × 6 folds · Sharpe ≥ 1.5 net · Deflated Sharpe ≥ 1.0 · Max DD ≤ Agent DD limit · 14 days paper ≥ 80% of expectation · WebAuthn admin approval.

---

## 24. Audit, Compliance & Regulatory

### 24.1 Hash-chained audit log

```sql
CREATE TABLE audit.events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL,
  asof_ts TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,                  -- forecast|opinion|verdict|risk|order|fill|approval|voice|chat|config|tier_unlock|personality_change|event_block|system
  actor TEXT NOT NULL,
  payload JSONB NOT NULL,
  model_version TEXT,
  weights_hash TEXT,
  agent_version_hash TEXT,
  prev_hash BYTEA NOT NULL,
  row_hash BYTEA NOT NULL
);
```

### 24.2 S3 Object Lock (WORM)

Audit + voice + transcripts + chat → S3 Object Lock Compliance mode. 7-year immutable.

### 24.3 Compliance posture

Deriv gambling-regulator disclosure · "Not financial advice" banner (Shona + English) · risk disclosures at signup + live unlock + each tier unlock · jurisdiction attestation · IP geofence · ZIMRA tax note · voice consent · mem0 storage consent.

### 24.4 Data retention

Ticks 2y online + 7y S3 · audit + voice + chat 7y (Object Lock) · trade records 7y · mem0 2y default (configurable) · PII minimum + envelope-encrypted · GDPR `mem0.delete_all(user_id=...)` + Postgres pseudonymize.

---

## 25. Observability & Model Monitoring

### 25.1 Stack

Prometheus · Grafana · Loki · Tempo · Sentry · PagerDuty.

### 25.2 Required dashboards

Tick-to-Decision Latency · Tick-to-Order Latency · Per-Model Inference Time · Agent Token Spend · Slippage Distribution · Order Reject Rate · Drift · Capital Allocation Heatmap · Kill-Switch Timeline · Approval Queue Latency · Voice Session Metrics · **Agent Performance Leaderboard** · **Agent Aggression vs Outcome scatter** (v0.5) · **Tier Unlock Pipeline** (v0.5) · **Event Blackout Activity** (v0.5) · Edge Report · Profit Sweep · Auto-Pause Events · mem0 Memory Growth + Cost.

### 25.3 Model monitoring (Evidently AI)

Daily drift report · live PSI alert >0.25 · 30-day hit-rate decay > 15% → 25% sizing + page · 7-day shadow for upgrades · champion-challenger via WebAuthn.

### 25.4 SLOs

Gateway 99.95% · Tick-to-screen p99 <150ms · Tick-to-order p99 <250ms · Model p95 cloud <200ms / M1 CPU <500ms · Voice round-trip <800ms · mem0 search p95 <200ms · mem0 add async p95 <2s · Audit write 100%.

---

## 26. Dockerization & Deployment

### 26.1 Local dev — `docker compose up`

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    volumes: [pgdata:/var/lib/postgresql/data]
    ports: ["5432:5432"]
    environment: { POSTGRES_PASSWORD: dev }
  redis:
    image: redis:7.4-alpine
    ports: ["6379:6379"]
  nats:
    image: nats:2.10-alpine
    command: -js
    ports: ["4222:4222"]
  questdb:
    image: questdb/questdb:8
    volumes: [questdata:/var/lib/questdb]
    ports: ["9000:9000", "9009:9009"]
  gateway:
    build: ./services/gateway
    depends_on: [postgres, redis, nats]
    ports: ["8080:8080"]
    environment: { DERIV_APP_ID: ${DERIV_APP_ID:-1089} }
  api:
    build: ./services/api
    depends_on: [postgres, redis, nats]
    ports: ["8000:8000"]
  agents:
    build: ./services/agents
    depends_on: [postgres, redis, nats, api]
  voice-bridge:
    build: ./services/voice-bridge
    depends_on: [postgres, redis, nats, gateway]
  calendar-ingestor:                      # v0.5
    build: ./services/calendar-ingestor
    depends_on: [postgres, nats]
  ttm: { build: ./services/models/ttm, depends_on: [nats] }
  kronos-small: { build: ./services/models/kronos, depends_on: [nats] }
  kronos-base:
    build: ./services/models/kronos
    environment: { MODEL_VARIANT: base }
    depends_on: [nats]
  chronos-bolt: { build: ./services/models/chronos, depends_on: [nats] }
  timesfm: { build: ./services/models/timesfm, depends_on: [nats] }
  web:
    build: ./apps/web
    depends_on: [api, gateway]
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API: http://localhost:8000
      NEXT_PUBLIC_WS: ws://localhost:8080
volumes:
  pgdata:
  questdata:
```

`Makefile`:
```makefile
dev: ; docker compose up --build
dev-mps: ; docker compose up --build $(filter-out ttm kronos-small kronos-base chronos-bolt timesfm,$(SERVICES)) & ./scripts/run-tsfms-native.sh
down: ; docker compose down
clean: ; docker compose down -v
```

### 26.2 The M1 MPS caveat

Docker Desktop on Mac cannot pass MPS. TSFMs inside containers = CPU only. M1 CPU latencies are <500ms cycle — fine for dev paper trading. For backtest speed: `make dev-mps` runs TSFM workers natively (outside Docker) for Apple GPU acceleration.

### 26.3 Production (Kubernetes)

Same images deployed via Helm + ArgoCD to GKE Autopilot / EKS. Three node pools: hot-path CPU (gateway, risk, voice) · app CPU (FastAPI, orchestrator, attribution, calendar) · GPU L40S 48GB (BentoML models, cloud tier).

Stateful: managed Postgres HA + read replicas (hosts pgvector for mem0) · managed Redis · QuestDB self-hosted NVMe + S3 snapshots · NATS 3-node cluster.

### 26.4 Networking

Cloudflare WAF + DDoS + geofence · internal mTLS Linkerd · fixed-IP NAT egress for Deriv · Deriv creds only in `namespace=hot-path`.

### 26.5 Multi-region (Phase 8+)

Primary US-east · standby EU-west (closer to ZW) · Postgres logical replication · QuestDB streaming · NATS mirror · quarterly DR drill.

### 26.6 DR

WS reconnect with seq-resume · order idempotency (UUID) · trade-in-flight reconciliation · kill switch in Redis AOF + Postgres.

### 26.7 CI/CD

GitHub Actions build/test/typeshape/lint/Trivy/Semgrep + backtest regression. ArgoCD GitOps. Progressive delivery 1% → 10% → 50% → 100%, auto-rollback on error budget burn.

---

## 27. Security & Secrets

Doppler dev/staging · Vault prod (dynamic secrets, rotate Deriv tokens 90d) · Vault Agent injector + K8s SA auth · per-user Deriv tokens Vault Transit + per-user data keys, decrypted only in Go gateway in-process · Magic-link + WebAuthn MFA mandatory before live trading · admin hardware-key WebAuthn + audit · supply chain: Dependabot/Renovate, SBOM (Syft), Cosign signing, Kyverno admission, weights hash-pinned · LLM threat: `<user_data>` wrap, length-clamped + de-fanged outputs, allowlisted tools, Risk Agent final gate.

---

## 28. Cost Projection

### 28.1 Lean Local (~20 users)

| Item | $/mo |
|---|---|
| Gemini Flash (text agents) | 15 |
| Gemini Live (voice 20×10min/day) | 140 |
| Claude Haiku (Manager) | 5 |
| Groq Llama-3.1-8B (mem0 extraction) | 5 |
| Hosting (Hetzner CPX31) | 17 |
| Postgres (Neon Hobby) | 19 |
| Redis (Upstash) | 0–10 |
| QuestDB on VPS | 0 |
| S3 | 5 |
| Cloudflare | 0 |
| **Total** | **~$210** |

### 28.2 Cloud Standard (~200 users)

| Item | $/mo |
|---|---|
| Gemini 3.1 Pro (Manager) | 660 |
| Gemini Flash (Strategies, Research) | 100 |
| Gemini Live (200×15min/day) | 1,035 |
| Groq (mem0 extraction at scale) | 30 |
| GPU inference (2× L40S) | 2,000 |
| Postgres HA + Redis + GKE | 800 |
| QuestDB (2× n2-highmem-4 + NVMe) | 450 |
| NATS cluster | 120 |
| Observability | 80 |
| Cloudflare + S3 + misc | 80 |
| **Total** | **~$5,355** |

### 28.3 Cloud High (~2000 users)

3–5× Cloud Standard. Voice dominates (~$10k+/mo).

### 28.4 Suggested pricing tiers

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | Paper trade · 1 Agent · No voice · 14d trial |
| Starter | $19/mo (crypto OK) | Live · 5 Agents · 10min voice/day · 1 Member · Tiers 1–2 |
| Pro | $49/mo | Unlimited Agents · 60min voice/day · 3 Members · profit sweep · Tiers 1–5 |
| Team | $149/mo | 10 Members · admin · 4hr voice/day · attribution dashboard · Tiers 1–7 |
| Enterprise | Custom | All Tiers · multi-Company · dedicated · custom contracts |

---

## 29. Phased Delivery Roadmap

### Phase 0 — Foundations + Docker (Weeks 1–3)

- Monorepo (Turborepo) + CI skeleton
- `docker compose up` brings up everything
- Postgres schema (accounts, companies, members, agents, conversations, **tier state**, **personality fields**)
- Go gateway → Deriv demo, fan-out
- Next.js: company switcher · magic-link + WebAuthn · LITTLEBEE design tokens · Position Size Calc
- LLM adapter stubs (Gemini Flash, Claude, OpenAI)
- Multi-tenant scoping in every endpoint

### Phase 1 — Agent Mgmt + Personalities + mem0 + 2 TSFMs (Weeks 4–7)

- Agent CRUD UI with **personality preset picker** + **Custom params**
- **Agent radar chart** (initially seeded with preset defaults)
- mem0 integrated (pgvector, compound keys, Groq extraction)
- Backfill Deriv ticks_history + Dukascopy + Binance → QuestDB
- Polars feature pipeline
- TTM + Kronos-small in Docker on M1
- Forecasts as bands on chart
- **Tier 1 enforcement** (Forex Majors only by default)

### Phase 2 — Remaining 3 TSFMs + Strategies + Backtesting (Weeks 8–11)

- Chronos-Bolt-small + TimesFM 2.5 + Kronos-base
- 5 trading strategies as Python modules
- StrategySignal envelope with EV, win_prob, payoff_ratio
- Trade selection modes (specific/most-profitable/safest/balanced)
- Walk-forward + purged k-fold (vectorbt)
- Conformal calibration
- Backtest UI

### Phase 3 — Agents + Approval Queue + Kelly + Attribution + Tier Manager (Weeks 12–16)

- LangGraph: Manager + 5 Strategy Agents + Research + Risk Agent
- mem0 in chat flow
- Hash-chained audit log + S3 Object Lock
- Approve-each mode UI
- Per-agent virtual allocation enforcement
- **Kelly-criterion sizing**
- **Performance attribution dashboard** (per Agent / strategy / regime / asset / event-window)
- **Auto-pause** for losing Agents
- **Personality detector cron** (Aggression Index daily)
- **Tier manager service + Tier Map UI**
- Paper trading end-to-end

### Phase 4 — Conversational + Calendar Engine (Weeks 17–21)

- Text chat per Agent
- Voice Bridge (Gemini Live)
- Per-Agent voice config
- Voice modal + transcript + tap-confirm
- Voice audit to S3 Object Lock
- Voice safety hard rules
- **Calendar ingestor** (Forex Factory + Finnhub)
- **Risk Agent event blackouts**
- **Calendar features** to TSFMs (time_to_event, event_impact_score)
- **Strategy event-adaptation rules**
- **Event-aware sizing**

### Phase 5 — Sentiment + Signals + Full Deriv Contract Registry (Weeks 22–24)

- Polymarket + Kalshi + Manifold price clients
- Finnhub news; GDELT daily
- Volume profile, VWAP, OFI proxy, funding rates, cross-asset correlations
- Sentiment momentum
- Wire to multivariate TSFMs as covariates
- **Contract type plugin registry** with Tier 1–4 plugins (Multipliers, Accumulators, Turbos)
- Add Tier 5+ contract plugins progressively

### Phase 6 — Real-Money Safeguards + Strategy Discovery (Weeks 25–27)

- **Profit sweep** + insurance fund + greed/cooling-off limits
- **Edge Report** dashboard
- **Optuna** hyperparameter search (strategy × asset × Agent)
- Walk-forward strategy optimization
- Drift detection (Evidently)
- Continuous learning trigger

### Phase 7 — Hardening + ZW Public Beta (Weeks 28–32)

- Kill switch (3 triggers, per-Company + per-Agent)
- Circuit breakers
- WebAuthn live-trade unlock
- 14-day paper gate
- ZW onboarding: crypto deposit · Shona translations · Lite mode
- Full Grafana dashboards
- DR drill #1
- Legal review (ZW + Deriv compliance)
- Pricing tiers + Stripe + crypto-pay
- Onboard ≤20 paying ZW users
- **RL execution agent (PPO)** shadow-mode trial
- Tier 5–7 contract plugins live for users who unlocked

### Phase 8 — Africa Expansion + GPU + Mobile + Full Deriv (Months 8–12)

- Cloud GPU tier (Chronos-2 + FinCast 1B) opt-in
- Expand: Kenya / Nigeria / SA / Ghana
- Per-Manager Deriv accounts
- Mobile (PWA install + React Native)
- Tier 8–9 contract plugins (full Deriv universe)
- Optional LLM fine-tune per Agent
- Optional XGBoost regression head per Agent
- Optional PatchTST/NHITS ensemble diversifiers
- Phase 8.5: genetic strategy discovery, strategy marketplace

---

## 30. Open Questions & Risks

### 30.1 Open questions

| # | Question | Status |
|---|---|---|
| 1–12 | All previously asked | ✅ Answered |
| 13 | Pricing model | Suggested 5 tiers (§28.4); needs validation |
| 14 | Legal entity in ZW | TBD (offshore vs in-country) |
| 15 | Customer support | Recommend in-app chat + WhatsApp + email |
| 16 | Personality preset names | Sniper/Scalper/Hunter/Guardian/Balanced — feedback welcome |
| 17 | Default tier progression | 9 tiers as in §8; reorderable in admin if needed |

### 30.2 Top risks

| Risk | Likely | Impact | Mitigation |
|---|---|---|---|
| TSFMs underperform zero-shot | Medium | High | Per-asset fine-tune; ensemble |
| M1 8GB memory walls | Medium | Medium | Lazy-load LRU; cloud burst |
| Deriv archived client breaks | Medium | Medium | Go gateway rewrite Phase 1 |
| LLM/voice cost spike | Medium | Medium | Per-Company caps; Groq for extraction |
| Voice 15-min session UX | High | Low | Resumption tokens |
| Voice over slow mobile | High | Medium | LiveKit/WebRTC; chat fallback |
| Shona-only users excluded | Medium | High | Phase 7+ translation; banner v1 |
| ZW payment friction | High | High | Crypto-first onboarding |
| Internet outages mid-trade | High | Medium | Reconnect-seq-resume; Lite mode |
| ZESA outages | High | Medium | Cloud-side execution |
| Regulatory action | Low | Catastrophic | Geofence + attestation + counsel |
| Look-ahead bias | Medium | Catastrophic | Purged k-fold + asof + shadow |
| Kill switch fails | Low | Catastrophic | 3 triggers + persistence + drill |
| AI hallucination → bad trade | High | Medium | Risk Agent veto; citation; approve-each default |
| Voice deepfake → trade | Medium | Catastrophic | Tap-confirm + WebAuthn always |
| Cross-tenant data leak | Low | Catastrophic | RLS + per-Company NATS + per-Company mem0 collection |
| mem0 extraction cost surprise | Medium | Medium | Groq; budget alarms |
| Agent loses long-term | High | High | Auto-pause + attribution + edge report |
| User over-trust → big loss | High | High | Approve-each default + greed/cool-off + sweep |
| Greed → ruin | High | High | Fractional Kelly + sweep + cool-down |
| **Personality mismatch (declared ≠ detected)** | Medium | Medium | Daily Aggression Index + dashboard warning |
| **User unlocks tier prematurely** | Medium | High | Hard gates + WebAuthn + risk disclosure |
| **Event blackout false positive** | Low | Medium | Manual override per-trade with audit |
| **Calendar source quality** | Medium | Medium | Cross-check Forex Factory + Finnhub; flag discrepancies |
| Gateway crash mid-trade | Medium | High | Reconciliation; portfolio sync |
| Slippage worse than backtest | High | Medium | Slippage-adjusted backtest; live breaker |
| Strategy ≠ asset mismatch | Medium | Low | Per-asset enable; promotion gate |
| Learning loop overfits | Medium | Medium | 90d rolling memory; regime-stratified retrieval |

### 30.3 Deferred to later

Native mobile (Phase 8) · multi-broker (v1 Deriv only) · social / copy-trading · strategy marketplace · public API for user models · ZIMRA tax automation · Shona STT/TTS · LLM fine-tuning per Agent · genetic strategy discovery.

---

## 31. Appendix A — Repository Layout

```
trade-master/
├── PLAN.md
├── README.md
├── Makefile                         ← make dev / dev-mps / down / clean
├── docker-compose.yml               ← full dev stack
├── docker-compose.mps.yml           ← override for native TSFMs
├── .github/workflows/
├── deploy/
│   ├── argocd/ helm/ terraform/
├── services/
│   ├── gateway/                     ← Go: Deriv WSS, order router, voice proxy, event blackout
│   ├── api/                         ← FastAPI: REST, auth, KYC, agent CRUD, backtest
│   ├── voice-bridge/                ← FastAPI: Gemini Live
│   ├── calendar-ingestor/           ← v0.5: Forex Factory + Finnhub scrape
│   ├── agents/                      ← LangGraph
│   │   ├── manager.py
│   │   ├── strategies/              ← deterministic strategy modules
│   │   ├── research.py
│   │   ├── risk.py                  ← deterministic, NO LLM
│   │   ├── memory.py                ← mem0 wrapper
│   │   ├── personality.py           ← v0.5: detector + presets
│   │   ├── trade_selection.py       ← v0.5: specific/profitable/safest/balanced
│   │   ├── learner.py               ← weekly distillation
│   │   ├── auto_pauser.py
│   │   ├── perf_attribution.py
│   │   ├── tier_manager.py          ← v0.5: tier eligibility + unlock
│   │   ├── llm_adapter/
│   │   │   ├── base.py
│   │   │   ├── anthropic.py openai.py gemini.py groq.py local_ollama.py
│   │   └── prompts/                 ← versioned, per role + personality
│   ├── models/                      ← TSFM servers (Docker)
│   │   ├── ttm/ kronos/ chronos/ timesfm/ fincast/
│   ├── contracts/                   ← v0.5: Deriv contract plugin registry
│   │   ├── registry.py
│   │   └── plugins/
│   │       ├── multipliers.py       (Tier 1)
│   │       ├── accumulators.py      (Tier 2)
│   │       ├── turbos.py            (Tier 5)
│   │       ├── vanilla_options.py   (Tier 7)
│   │       ├── classic_binary.py    (Tier 8)
│   │       ├── touch_notouch.py     (Tier 8)
│   │       ├── higher_lower.py      (Tier 8)
│   │       ├── inout.py             (Tier 8)
│   │       ├── asians.py            (Tier 9)
│   │       ├── digits.py            (Tier 9)
│   │       ├── reset.py             (Tier 9)
│   │       └── tick_highlow.py      (Tier 9)
│   ├── strategies_lib/              ← deterministic strategy modules
│   ├── signals/                     ← Polymarket, Kalshi, Manifold, Finnhub, GDELT, funding rates
│   ├── execution/                   ← VWAP, slippage models, RL agent (Phase 7+)
│   └── audit/                       ← hash-chain verifier + S3 writer
├── packages/
│   ├── schemas/                     ← shared OpenAPI / Protobuf / Zod
│   ├── ts-sdk/ py-sdk/
├── apps/
│   └── web/                         ← Next.js 16
│       ├── Dockerfile
│       ├── app/(auth)/ (app)/[company]/
│       │   ├── discover/
│       │   ├── trading/
│       │   ├── agents/[agent]/      ← profile with radar
│       │   ├── models/
│       │   ├── edge-report/
│       │   ├── attribution/
│       │   ├── profit-sweep/
│       │   ├── tiers/               ← v0.5: Tier Map
│       │   ├── economic-calendar/
│       │   ├── approvals/
│       │   ├── conversations/
│       │   ├── trades/
│       │   └── settings/
│       ├── components/
│       │   ├── company-switcher/
│       │   ├── agent-card/
│       │   ├── agent-config-form/   ← personality + trade-selection + assets+contracts tabs
│       │   ├── agent-radar/         ← v0.5: 6-axis radar
│       │   ├── tier-map/            ← v0.5
│       │   ├── chat-panel/
│       │   ├── voice-modal/
│       │   ├── approval-modal/     ← event-aware banner
│       │   ├── kill-switch/
│       │   ├── strategy-verdict-card/
│       │   ├── position-size-calc/
│       │   ├── market-hours-globe/
│       │   ├── economic-events/    ← clickable event detail
│       │   ├── event-blackout-banner/ ← v0.5
│       │   ├── edge-report-card/
│       │   ├── attribution-chart/
│       │   ├── balance-pills/
│       │   ├── hero-balance-chart/
│       │   ├── decisions-log/
│       │   └── risk-panel/
│       ├── hooks/
│       │   ├── use-tick-stream.ts
│       │   ├── use-voice-session.ts
│       │   ├── use-approval-queue.ts
│       │   ├── use-mem0.ts
│       │   ├── use-personality.ts   ← v0.5
│       │   ├── use-tier.ts          ← v0.5
│       │   └── use-ws.ts
│       ├── lib/audio/
│       └── styles/tokens.css         ← dark-lime + dark-cyan
├── notebooks/
├── data/
│   ├── backfill/{deriv,dukascopy,binance}/
│   └── features/
├── training/
│   ├── ttm/ kronos/ chronos/ timesfm/
├── designs/
│   └── image.png                    ← LITTLEBEE inspiration
└── tools/
    ├── audit-verifier/
    ├── backtest-cli/
    ├── data-backfill-cli/
    ├── mem0-admin/
    └── tier-eligibility-cli/        ← v0.5
```

---

## 32. Appendix B — Reference Links

### Foundation Models
- [Kronos](https://github.com/shiyu-coder/Kronos) · [paper](https://arxiv.org/abs/2508.02739)
- [TimesFM](https://github.com/google-research/timesfm) · [2.5](https://huggingface.co/google/timesfm-2.5-200m-pytorch)
- [Chronos](https://github.com/amazon-science/chronos-forecasting) · [Chronos-2](https://huggingface.co/amazon/chronos-2)
- [FinCast](https://github.com/vincent05r/FinCast-fts) · [paper](https://arxiv.org/abs/2508.19609)
- [granite-tsfm (TTM)](https://github.com/ibm-granite/granite-tsfm) · [commercial weights](https://huggingface.co/ibm-granite/granite-timeseries-ttm-r2)

### Memory
- [mem0 repo](https://github.com/mem0ai/mem0) · [docs](https://docs.mem0.ai/) · [Self-host Docker](https://mem0.ai/blog/self-host-mem0-docker) · [Multi-Agent Memory](https://mem0.ai/blog/multi-agent-memory-systems)
- [Groq + Mem0](https://groq.com/customer-stories/mem0-redefines-ai-memory-with-real-time-performance-on-groqcloud)
- [LangGraph + Mem0 tutorial](https://www.digitalocean.com/community/tutorials/langgraph-mem0-integration-long-term-ai-memory)

### APIs
- [Deriv Developer Portal](https://developers.deriv.com/docs/) · [ticks_history](https://developers.deriv.com/docs/data/ticks-history/) · [Workflows](https://developers.deriv.com/docs/workflows/)
- [Polymarket API](https://docs.polymarket.com/api-reference/introduction) · [py-clob-client](https://github.com/Polymarket/py-clob-client)
- [Kalshi API](https://docs.kalshi.com/getting_started/historical_data) · [Manifold API](https://docs.manifold.markets/api)
- [Finnhub](https://finnhub.io/pricing) · [GDELT 2.0](https://www.gdeltproject.org/data.html)
- [Binance klines](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints) · [data.binance.vision](https://data.binance.vision)
- [Forex Factory scraper (Apify)](https://apify.com/scrapemint/forexfactory-economic-calendar)
- [Trading Economics calendar API](https://tradingeconomics.com/api/calendar.aspx)

### Price-data sources
- [Dukascopy](https://www.dukascopy.com/swiss/english/marketwatch/historical/) · [dukascopy-node](https://github.com/Leo4815162342/dukascopy-node)
- [HistData](https://www.histdata.com/download-free-forex-data/) · [Polygon.io](https://polygon.io/pricing) · [EODHD](https://eodhd.com/pricing)

### LLMs & Voice
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) · [tools](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Anthropic API](https://docs.anthropic.com/) · [OpenAI API](https://platform.openai.com/docs)
- [Groq](https://groq.com/) · [Ollama](https://ollama.com/) · [MLX-LM](https://github.com/ml-explore/mlx-lm)
- [LiveKit Gemini](https://docs.livekit.io/agents/models/realtime/plugins/gemini/) · [Pipecat Gemini](https://docs.pipecat.ai/guides/features/gemini-live)

### Stack
- [Next.js](https://nextjs.org/) · [TradingView LWC](https://www.tradingview.com/lightweight-charts/) · [BentoML](https://www.bentoml.com/) · [LangGraph](https://langchain-ai.github.io/langgraph/) · [NATS](https://nats.io/) · [QuestDB](https://questdb.io/) · [pgvector](https://github.com/pgvector/pgvector)

### Real-money trading
- [FIA — Automated Trading Risk Controls](https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf)
- [vectorbt walk-forward](https://trader-algoritmico.com/blog/vectorbt-vectorized-walk-forward-avoiding-look-ahead-bias-in-python)
- [Kelly Criterion (Investopedia)](https://www.investopedia.com/articles/trading/04/091504.asp)
- [Evidently AI drift](https://www.evidentlyai.com/ml-in-production/data-drift) · [Optuna](https://optuna.org/)

### Design / UX
- [Bloomberg color accessibility](https://www.bloomberg.com/ux/2021/10/14/designing-the-terminal-for-color-accessibility/)
- LITTLEBEE inspiration: `/designs/image.png`

### Zimbabwe / Africa
- [Yellow Card](https://yellowcard.io/) · [Binance P2P](https://p2p.binance.com/)
- [Deriv regulatory](https://deriv.com/regulatory)

---

## 33. Operations, Trust & Growth — Launch Readiness Completeness

The preceding 32 sections cover the AI, trading, agent, and data architecture. This section covers everything *around* it that turns a technical achievement into a production fintech. Skip none of these.

### 33.1 Account recovery + ATO defense

WebAuthn alone will lock out 5–15% of users in month one. Defense in depth:

| Layer | Implementation |
|---|---|
| Recovery factor 1 | **BIP39 12-word recovery codes** shown once at signup, encrypted at rest, never logged |
| Recovery factor 2 | **≥ 2 registered passkeys required** (phone + laptop) before live trading enabled |
| Recovery factor 3 | **Trusted-contact recovery** — 2 of 3 named contacts attest |
| Recovery factor 4 | **KYC re-verification** as last-resort, with **mandatory 72-hour cool-down** + email + SMS before funds can move |
| Anomaly detection | **Castle.io** ($400/mo for 100k MAU). Signals: ASN change + new device + first trade > $X within 1hr → step-up auth |
| Withdrawal hardening | New address → 24h delay + email confirmation. Any withdrawal > 50% balance → step-up + **Persona** liveness check (~$1.50/check) |
| Session security | Access tokens 15 min · refresh bound to device fingerprint · re-auth before irreversible actions |

### 33.2 Customer support stack (ZW-realistic)

ZW users expect WhatsApp-first. Stack:

| Component | Pick | Cost |
|---|---|---|
| Primary channel | **WhatsApp Business Platform via 360dialog** | ~$0.003–$0.005/conversation (cheaper for Africa than Twilio) |
| Helpdesk | **Crisp** (WhatsApp-native, team plan) | ~$95/mo |
| Knowledge base | **Mintlify** docs | Free tier viable |
| AI-powered FAQ | **Inkeep** or **Kapa.ai** (RAG over our docs) | ~$200/mo |
| Status page | **Instatus** | $20/mo |
| Community | **Telegram** (preferred over Discord in ZW 2026) | Free |

Two Telegram channels: public announcements + gated "Verified Traders" group requiring KYC completion.

### 33.3 Billing & payments

| Use case | Recommended | Backup |
|---|---|---|
| International cards | **Paystack** or **Flutterwave** (Africa-friendly KYC) | Stripe if approved |
| Crypto | **NOWPayments** (0.5% fee, 300+ coins, direct-to-wallet settlement) | BTCPay Server (self-hosted, 0% but ops-heavy) |
| ZW local rails | **EcoCash** merchant API + **InnBucks** | — |
| Direct stable | Accept **USDT (TRC-20)** addresses directly | — |
| Subscription mgmt | **Lago** (open source, free up to $1M ARR) | Stripe Billing if Stripe-only |

Quote prices in USD always. Accept ZWL/ZIG only via crypto bridge — local currency volatility will eat margins.

### 33.4 Legal — don't use Termly

For a fintech handling money + AI + multi-tenant data, generator output won't protect you.

| Document | Approach |
|---|---|
| ToS, Privacy Policy, Risk Disclosure, AUP | **TermsFeed Enterprise** first draft ($500-1000), then **dual-jurisdiction lawyer review** (ZW + incorporation jurisdiction) |
| AI Use Policy | Separate document (§33.10) |
| Cookie Policy | Generator OK if geofencing to Africa |
| DPA | Only if processing EU/UK data |

**ZW-specific:** comply with **Cyber and Data Protection Act (Ch. 12:07)** — register a Data Protection Officer with **POTRAZ**. Recommended counsel: **Bowmans** or **ENSafrica** (Africa-wide); **Manokore Attorneys** or **Atherstone & Cook** (Harare).

**Budget:** $8–15k for launch-ready legal in 2026. Skip and you'll spend 10× defending it.

**Incorporation:** likely **Mauritius**, **Seychelles**, or **BVI** for an Africa-focused fintech. Talk to counsel before incorporating.

### 33.5 Notifications stack

| Channel | Pick | Why |
|---|---|---|
| Transactional email | **Resend** ($20/mo for 50k) | Best DX, React Email templates |
| Push (web) | **Web Push** (free, native) | No third party |
| Push (mobile) | **FCM** (free) | When PWA installed |
| WhatsApp | **360dialog** | 30-40% cheaper for Africa than Twilio |
| SMS (ZW) | **Africa's Talking** ($0.025-0.04/SMS to Econet/NetOne/Telecel) | 4× cheaper than Twilio for ZW |
| Orchestration | **Novu** (open source) or **Knock** ($250/mo) | Preferences + templates + fallback in one place |

Granular per-user preferences: which events, which channels, quiet hours, smart batching ("3 trades in last 5 min" → 1 notification).

### 33.6 Product analytics

| Tool | Use |
|---|---|
| **PostHog Cloud EU** ($0 up to 1M events/mo) | Product behavior, funnels, cohorts, session replay |
| **Plausible** ($9/mo) | Marketing site only, cookieless, GDPR-clean |

**Critical:** mask all account values, balances, and trade details server-side in session replay. **Do not record financial PII** even encrypted.

**Event taxonomy** defined before launch: `domain.object.verb` (e.g., `trade.signal.generated`, `agent.position.opened`, `tier.unlock.requested`).

### 33.7 Public API & webhooks — deferred to v2

Launch-day power users will be < 50 people. A half-baked public API is a permanent maintenance tax. When built (v2):

- **Webhook delivery:** **Svix** ($0 up to 50k messages/mo) — signed payloads, retries, replay, dashboards
- **API gateway:** Kong or Hookdeck
- **Versioning:** `/v1/` in URL from day one; deprecation policy before publishing

### 33.8 Feature flags & A/B testing

**GrowthBook self-hosted** (free, open source, ClickHouse-backed). For a trading platform: **gate every model/strategy/agent change** behind a flag. Roll new TSFM versions 5% → 25% → 100% based on P&L deviation vs control. Statsig is the credible cloud-only alternative (2M events/mo free).

### 33.9 ZW growth strategy

Don't run paid Meta ads — finance CPMs are insane in Africa. Real channels:

| Channel | Tactic |
|---|---|
| **WhatsApp communities** | Seed 3–5 trader groups with hand-picked early users; weekly P&L roundup |
| **YouTube creators** | Sponsor mid-tier ZW finance creators (5–50k subs); covers ZSE/VFEX/forex education |
| **EcoCash partnership** | Pitch co-marketing — they have distribution, we have product |
| **University trading societies** | UZ, NUST, HIT — sponsor competitions with paper accounts; prize = real funded account |
| **Referral** | Double-sided ($10 funded credit each). Anti-abuse: referrer earns only after referee places 10 real trades AND holds > 30 days |
| **Telegram funnel** | Public channel → degraded free signals → CTA to platform |

### 33.10 AI Use Policy + Model Cards

**Publish as a separate document** from ToS. Mandatory sections:

1. Which models are used for which decisions
2. Explicit statement: AI signals are **not investment advice**
3. Human-in-the-loop story (which trades auto-execute, which require user approval)
4. Bias and failure modes acknowledged
5. How user data feeds (or doesn't feed) model training
6. User rights — export mem0, opt out, delete
7. Audit / inspection rights — surface the hash-chained audit log to users, not just regulators

**Plus a Model Card per TSFM** in plain English: training data window, known weaknesses, expected drawdown ranges, last revalidation date. Becoming a 2026 regulator expectation.

References: [Anthropic Usage Policy](https://www.anthropic.com/legal/aup), [Robinhood AI disclosures](https://robinhood.com/).

### 33.11 Tax Center (ZIMRA — build, don't buy)

No vendor supports ZIMRA in 2026. Build a "Tax Center" generating:

- Realized P&L by tax year
- Capital gains schedule
- Crypto cost-basis (FIFO + specific-ID)
- **ZIMRA-formatted CSV + PDF**

Have a ZW tax attorney review the schedule format before publishing. This is a **trust multiplier** — users who trust your tax reporting refer aggressively.

### 33.12 Admin abuse prevention (insider-trading guard)

Audit logs catch it after the fact. **Structural prevention:**

1. **Signal embargo** — admin dashboards show encrypted signal payloads; plaintext decryption is gated by a separate quorum service that releases keys only after the signal has been delivered to every targeted user account + 30s settling window
2. **Trade lockout** — any admin account is structurally barred (at the order-router layer) from trading the same instruments AI agents are signaling within a rolling 60-minute window
3. **Two-person rule** — any change to model config, strategy weights, or agent assignment requires two distinct admin approvals (GitHub-style PR review + runtime quorum)
4. **Weekly position disclosure** — admins publish personal positions to a shared internal ledger weekly; front-running becomes socially visible
5. **External attestation** — quarterly **SOC 2 Type II readiness review** via Vanta or Drata (~$10k/yr); catches process gaps even before formal certification

### 33.13 Disaster Recovery & Incident Response

| Metric | Target |
|---|---|
| **RTO** (trading data) | ≤ 1 hour |
| **RPO** (trading data) | ≤ 5 min |
| **RTO** (analytics) | ≤ 4 hours |
| **RPO** (analytics) | ≤ 1 hour |

**Backups:** Postgres continuous WAL → S3 (separate account, Object Lock) + nightly logical dumps. **Test restore monthly** in a clean account.

**Runbooks:** one Markdown file per incident class — DB primary down · Deriv API outage · mem0 cluster lost · audit chain divergence · voice bridge dead · model server OOM. Each runbook: detection signals → immediate mitigation → escalation → comms template → postmortem trigger. Live in repo, not Confluence.

**On-call:** **Grafana OnCall** (free, open source) or **incident.io** ($16/seat/mo). Skip PagerDuty pre-Series A.

**Postmortems (system, not trade):** blameless, due within 5 business days, tracked actions. Publish customer-facing summaries on the status page for any incident affecting trades or funds.

**Game days:** quarterly chaos drill — kill a region, lose mem0, corrupt audit head — verify recovery.

### 33.14 Onboarding for first-time traders

ZW users new to derivatives are **the** moment of truth. Don't make any of this optional.

| Step | Tool / approach |
|---|---|
| **Paper-trade gate** | 14 days OR 50 trades before live funds enabled |
| **Interactive tutorial** | **Shepherd.js** for in-app tour, custom-built for the trading floor (not generic) |
| **Knowledge-check quiz** | 10 questions on leverage, stop-loss, what an AI agent is and isn't. **70% to pass** before first live trade |
| **Video walkthroughs** | 5× 60-second clips, **Shona and Ndebele subtitles** minimum, ideally voiced |
| **Default personality** | **Guardian (safest)** pre-selected for new accounts; switching requires extra risk acknowledgement |
| **First-trade hand-holding** | Manager Agent narrates the first three trades in voice + chat, regardless of trade_mode setting |

### 33.15 Launch-day discipline (the things people forget)

1. **Time zones** — Deriv runs UTC; ZW is UTC+2; servers must store UTC and convert only at UI edge. Daylight-saving transitions reorder forex sessions twice yearly.
2. **Float precision** — NEVER store money as float. Postgres `NUMERIC(20,8)` for crypto, `NUMERIC(20,4)` for fiat. Audit every code path.
3. **Idempotency keys** — every trade-creation request needs a client-provided idempotency key. Network retries during launch traffic will double-execute trades otherwise.
4. **Rate limits on us** — Deriv will rate-limit us before we rate-limit them. Implement client-side token buckets per WebSocket connection.
5. **Status-page lag** — publish incidents within 5 minutes or Telegram will do it for you, more dramatically.
6. **Bus factor ≥ 2** — if exactly one person can deploy, restart mem0, or rotate the audit signing key, we don't have a launchable system. Document and cross-train before launch.
7. **The "first big winner" problem** — when a user wins $50k from a $500 account in week two, we need an established withdrawal/verification flow that doesn't look like stalling. Pre-write the comms template.
8. **Regulatory letter day** — RBZ, SECZ, or POTRAZ will write us a letter in months 1–6. Have outside counsel on retainer (~$500/mo) so the response is fast and correct.
9. **Funnel signals** — track time-from-signup-to-first-trade and time-from-first-trade-to-second-trade. If either exceeds 7-day median, the funnel is broken regardless of NPS.
10. **Dollar-denominated alerting** — beyond Sentry error rates, alert on "if any single user's P&L changes by > $X in < Y seconds." Catches both bugs and exploits.
11. **The kill switch (recap)** — one button, two-admin approval, halts all agent trading globally. Test monthly. The day you need it you don't want to be writing it.
12. **Withdrawal flow rehearsal** — actually process a withdrawal end-to-end before any user does. KYC quirks, banking hold-times, Deriv settlement — all surface only in practice.
13. **Audit chain head signing** — generate the hardware-key signature for the audit chain head and store recovery codes offline. Lose this and your audit trail is unverifiable.

### 33.16 Things still NOT in v1 (deferred to v2/v3)

- **Native mobile app** (Phase 8 — PWA + RN)
- **Multi-broker** support (Deriv only)
- **Public API + Webhooks** (Phase 8)
- **Social / copy-trading**
- **Strategy & Agent Marketplace** (Phase 8.5)
- **Genetic strategy discovery**
- **Shona STT/TTS** voice (Shona text chat works in v1)
- **LLM fine-tuning** per Agent
- **PatchTST / NHITS** ensemble diversifiers (only if residual edge proven)
- **Affiliate program** beyond simple referral (after PMF)
- **Multi-currency UI display** (USD-only display in v1; payments accept others)
- **Full RTL language support** (defer until MENA expansion)
- **Tax automation for non-ZW jurisdictions**

---

## Sign-off — v1.0 Final Plan

**TradeMaster v1.0** is a complete plan for building, launching, and operating a multi-tenant AI-orchestrated trading platform on Deriv, targeted at Zimbabwe and wider Africa, runnable for development on a MacBook Air M1 8GB via full Docker.

The plan covers, in 33 sections:

- **AI architecture** — 5 TSFMs (Kronos / TimesFM / Chronos / FinCast / TTM) as forecast tools; pluggable LLM brain (Claude / GPT / Gemini / local); LangGraph orchestration; mem0 for per-user × per-agent memory; weekly lesson distillation; auto-deactivation.
- **Trading framework** — 5 classical strategies (Trend / Breakout / S&R / Mean Reversion / Price Action); 5 agent personalities (Sniper / Scalper / Hunter / Guardian / Balanced); 4 trade-selection modes (specific / most-profitable / safest / balanced); 9-tier progressive asset enablement covering all Deriv markets and contracts; economic-calendar-aware decisions with Investing.com + cross-source verification.
- **Real-money safeguards** — Kelly-criterion sizing; performance attribution by Agent × strategy × asset × regime × event-window; auto-deactivation of losing Agents; profit sweep + insurance fund; greed/cooling-off limits; per-trade postmortems with confidence trace; per-trade Employee ratings (Direction / Calibration / Information Value).
- **Multi-tenant SaaS** — Companies + Members + AI Agents with hierarchy, configurable LLM/voice/strategy/allocation; Aggression Index radar; full row-level security; per-Company mem0 collections.
- **Conversational** — chat + Gemini Live voice for every Agent with hard safety rules (Risk Agent voice-deaf; tap-confirm + WebAuthn always); ZW data-cost awareness; English-first with Shona text fallback.
- **Design** — LITTLEBEE-inspired `dark-lime` primary theme + `dark-cyan` CVD-safe alternate; Position Size Calc, Market Hours globe, Economic Events with country flags, Trade Postmortem panel, Employee Leaderboard, Tier Map.
- **Infrastructure** — full Docker dev stack (`docker compose up`) on M1 CPU; Docker + K8s prod; Go gateway (hot path) + FastAPI (cold path) + LangGraph (agents) + BentoML (model serving); NATS JetStream spine; QuestDB ticks + Postgres OLTP/pgvector/mem0; Redis ephemeral; S3 Object Lock audit WORM.
- **Operations & launch readiness** — account recovery; ATO defense via Castle.io; WhatsApp-first support via 360dialog; legal review via Bowmans/Manokore; Paystack + NOWPayments + EcoCash payment rails; admin insider-abuse guard rails; quarterly chaos drills; mandatory paper-trade gate; Shona-subtitled onboarding; AI Use Policy + per-TSFM Model Cards; build-your-own Tax Center for ZIMRA.

All foundational corrections from v0.1–0.5.1 carry forward:

- Gemini 3.5 doesn't exist — use 3.1 Pro / 2.5 Pro / 2.5 Flash
- TTM is NOT a Transformer — IBM Tiny Time Mixers (MLP-Mixer), Apache `granite-timeseries-ttm-r2`
- Polymarket is NOT training data — runtime sentiment feature only; train on Deriv ticks_history + Dukascopy + Binance
- LLMs ≠ TSFMs — LLMs reason; TSFMs forecast
- Voice is UI, never authorization — Risk Agent + Kill Switch voice-deaf
- Memory split — Postgres for trade ground truth; mem0 for conversational soft memory
- Docker on Mac can't pass MPS — accept CPU TSFMs in dev or use `make dev-mps` override

### Phase 0 — start here

**Three weeks on the M1 to get to "Hello, trader":**

```
make dev              # full Docker stack: postgres + redis + nats + questdb +
                      # gateway + api + agents + voice-bridge + calendar-ingestor
                      # + 5 TSFM workers + web
```

Then in the browser at `localhost:3000`:

1. Sign up with magic link + WebAuthn
2. Create your first Company (e.g., "Tendai Capital")
3. Add Deriv demo `app_id=1089` and a virtual-account token
4. See live Vol 75 ticks streaming into a TradingView Lightweight Chart
5. See the Position Size Calculator side-panel
6. See the Tier Map (Tier 1 only — Forex Majors unlocked)
7. Click around the LITTLEBEE-styled empty Agent gallery, ready to populate

Three weeks. One working app. No agents yet. **Ship that first**, then Phase 1.

### Beyond Phase 0

- **Phase 1** (Weeks 4–7) — Agent CRUD + Personalities + mem0 + 2 TSFMs + ticks backfill
- **Phase 2** (Weeks 8–11) — Remaining 3 TSFMs + Strategies + Backtesting
- **Phase 3** (Weeks 12–16) — Agents + Approval + Kelly + Attribution + Tiers
- **Phase 4** (Weeks 17–21) — Chat + Voice + Economic Calendar Decision Engine
- **Phase 5** (Weeks 22–24) — Polymarket/Kalshi/sentiment + Full Deriv contract registry
- **Phase 6** (Weeks 25–27) — Profit sweep + Optuna + Drift + Edge Report
- **Phase 7** (Weeks 28–32) — Hardening + ZW public beta + ≤20 paying users
- **Phase 8** (Months 8–12) — Africa expansion + GPU + Mobile + Tiers 8–9 + RL execution

Public beta in **~30 weeks** (~7 months). First $1 of revenue at Phase 7.

### Final word

Most ambitious trading-platform plans fail not on the AI but on **operations** — the parts most engineers find boring. This document treats them with the same seriousness as the TSFM ensemble. Don't skip §33. The first regulator letter, the first lost device, the first big winner, the first ZESA outage during NFP — they all arrive in the first six months. We are ready for them.

Green-light Phase 0.
