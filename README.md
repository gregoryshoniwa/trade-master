# TradeMaster

AI-orchestrated multi-model trading platform on Deriv. Multi-tenant SaaS launching in Zimbabwe.

See [PLAN.md](PLAN.md) for the full architecture document.

## Quickstart

Requires: Docker Desktop, Go 1.22+ (for native dev), Node 22+ (for native web dev).

```bash
make dev          # bring up full Docker stack on M1
make logs         # tail all services
make down         # stop everything
make clean        # stop + remove volumes (destroys local data)
```

Then open <http://localhost:3000> for the web app and watch live ticks streaming.

## Host port map

Host-side ports are deliberately non-default so they don't clash with other
local apps. Internally, every service still talks to its peers on
container-network ports via service names (no localhost involved).

| Service | Host port | Container port |
|---|---|---|
| Web (Next.js) | 3000 | 3000 |
| API (FastAPI) | 8000 | 8000 |
| Gateway (Go, Deriv WSS + browser WS fan-out) | **18080** | 8080 |
| TTM forecaster (FastAPI + ML) | **18081** | 8081 |
| Postgres (+pgvector) | 5432 | 5432 |
| Redis | 6379 | 6379 |
| NATS JetStream (client / monitor) | 4222 / 8222 | 4222 / 8222 |
| QuestDB (HTTP / ILP / PG wire) | 9000 / 9009 / 8812 | 9000 / 9009 / 8812 |

The browser hits `NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws/ticks` for the
live tick + forecast stream.

## Current state — Phase 0/1 in progress

| Service | Status |
|---|---|
| Postgres (+ pgvector) | ✅ schema migrated · pgvector ready for mem0 |
| Redis | ✅ |
| NATS JetStream | ✅ ticks.> + signals.> active |
| QuestDB | ✅ tick history persisting · `/history` endpoint live |
| **gateway** (Go) | ✅ Deriv WSS → NATS → browser WS fan-out (5 symbols) |
| **api** (FastAPI) | ✅ magic-link auth, companies, agents, personalities, symbols |
| **ttm** (TTM granite-r2) | ✅ 5 buffers · 5 forecasts/cycle on M1 CPU |
| **web** (Next.js) | ✅ chart with TTM band, AssetPicker, agent CRUD |
| agents (LangGraph + LLMs) | ⏳ next: chat panel + mem0 |
| voice-bridge | ⏳ Phase 4 |

## Repository layout

See [PLAN.md §31 Appendix A](PLAN.md) for the full target layout. Current actual:

```
trade-master/
├── PLAN.md
├── README.md
├── AGENTS.md                 ← for future Claude sessions
├── Makefile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── designs/
│   └── image.png             ← LITTLEBEE inspiration
└── services/
    └── gateway/
        ├── Dockerfile
        ├── go.mod
        ├── cmd/gateway/main.go
        └── internal/
            └── deriv/
```

## License

Proprietary. All rights reserved.
