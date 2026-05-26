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

## Current state — Phase 0 in progress

| Service | Status |
|---|---|
| Postgres (+ pgvector) | ✅ docker-compose ready |
| Redis | ✅ docker-compose ready |
| NATS JetStream | ✅ docker-compose ready |
| QuestDB | ✅ docker-compose ready |
| **gateway** (Go, Deriv WSS) | 🚧 hello-world streaming R_75 ticks |
| api (FastAPI) | ⏳ pending Phase 0 |
| agents (LangGraph) | ⏳ pending Phase 1 |
| voice-bridge | ⏳ pending Phase 4 |
| TSFM model servers | ⏳ pending Phase 1 |
| web (Next.js) | ⏳ pending Phase 0 |

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
