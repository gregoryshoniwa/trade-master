# AGENTS.md — guide for future Claude/dev sessions

## What this project is

TradeMaster: AI-orchestrated multi-tenant trading platform on Deriv. Full architecture in [PLAN.md](PLAN.md) (33 sections, v1.0).

## How dev works

```bash
make dev          # docker compose up + tail logs
make gateway-logs # just the Go gateway (Deriv tick stream)
make down         # stop everything (keep data)
make clean        # stop + wipe volumes
make migrate      # apply pending Postgres migrations
```

## Host port map (non-default to avoid local conflicts)

| Service | Host | Container |
|---|---|---|
| Web | 3000 | 3000 |
| API | 8000 | 8000 |
| Gateway | **18080** | 8080 |
| TTM | **18081** | 8081 |
| Postgres | 5432 | 5432 |
| Redis | 6379 | 6379 |
| NATS | 4222 (8222 mon) | same |
| QuestDB | 9000 / 9009 / 8812 | same |

Service-to-service traffic stays inside the docker network on the container
ports — host ports only matter for the browser and external tools.

Stack runs on Docker Desktop on macOS M1. **TSFM inference inside containers is CPU-only** (Docker on Mac can't pass MPS). For MPS speed, run TSFM workers natively via `make dev-mps` (not implemented yet — Phase 1).

## Current state — Phase 0

See [README.md](README.md) "Current state" table for what's built vs pending.

### Phase 0 goals (3 weeks)
1. ✅ Monorepo + Docker Compose + Makefile
2. ✅ Postgres + Redis + NATS + QuestDB up
3. 🚧 **Go gateway connecting to Deriv demo and streaming R_75 ticks** ← we are here
4. ⏳ Postgres schema (accounts, companies, members, agents, conversations, tier state, personality fields)
5. ⏳ Next.js auth (magic link + WebAuthn) + company switcher
6. ⏳ Next.js dashboard with TradingView Lightweight Charts streaming ticks
7. ⏳ Position Size Calculator widget (LITTLEBEE-styled)
8. ⏳ LLM adapter stubs (Gemini Flash, Claude, OpenAI)

## Conventions

- **Languages by service:** Go for hot path (gateway, order router, voice proxy). Python (FastAPI) for everything else. TypeScript (Next.js 16) for web.
- **Time:** UTC everywhere internally. Convert only at UI edge.
- **Money:** Postgres `NUMERIC(20,8)` crypto / `NUMERIC(20,4)` fiat. NEVER float.
- **Idempotency:** every trade-creating request needs a client UUID.
- **Multi-tenancy:** every query scoped by `company_id`. Row-level security planned.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`). One concern per commit.
- **Branches:** main is the trunk. Phase work on `phase-N-<topic>` branches.
- **Secrets:** never commit. `.env` is gitignored. Use Vault in prod.

## Where to find things

| Concern | Location |
|---|---|
| Architecture decisions | [PLAN.md](PLAN.md) |
| Design proposal | [designs/image.png](designs/image.png) (LITTLEBEE) |
| Docker stack | [docker-compose.yml](docker-compose.yml) |
| Common commands | [Makefile](Makefile) |
| Environment variables | [.env.example](.env.example) |
| Go gateway | [services/gateway/](services/gateway/) |

## When continuing this work

1. Read this file first.
2. Read [PLAN.md](PLAN.md) §29 (Phased Delivery Roadmap) to find where we are.
3. Check `git log --oneline -20` for recent work.
4. Run `make ps` to see what's running.
5. Don't add new content to [PLAN.md](PLAN.md) without the human's say-so — it's signed off at v1.0.

## Non-goals (don't waste time on these in Phase 0)

- Real trading (use Deriv demo `app_id=1089`, no auth token, ticks-only)
- LLM integration (Phase 1+)
- TSFM model serving (Phase 1+)
- Voice (Phase 4+)
- Anything in §10 Real-Money Enhancements (Phase 3+)
- Mobile app (Phase 8)
