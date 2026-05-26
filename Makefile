.PHONY: help dev up down logs ps clean rebuild gateway-logs migrate migrate-down migrate-status psql

DB_URL ?= postgres://trademaster:dev_change_me@postgres:5432/trademaster?sslmode=disable
MIGRATE_IMAGE = migrate/migrate:v4.18.1

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: up logs ## Bring up the stack and tail logs

up: ## Build + start all services
	@test -f .env || cp .env.example .env
	docker compose up --build -d
	@echo ""
	@echo "✓ Stack is up. Services:"
	@echo "    Postgres : localhost:5432"
	@echo "    Redis    : localhost:6379"
	@echo "    NATS     : localhost:4222 (mon: http://localhost:8222)"
	@echo "    QuestDB  : http://localhost:9000"
	@echo "    Gateway  : http://localhost:8080  ws://localhost:8080/ws"
	@echo ""
	@echo "  make logs            tail all services"
	@echo "  make gateway-logs    tail gateway only (see live Deriv ticks)"

down: ## Stop all services (keep data)
	docker compose down

clean: ## Stop + remove volumes (destroys local data)
	docker compose down -v

rebuild: ## Force rebuild gateway and restart
	docker compose build --no-cache gateway
	docker compose up -d gateway

logs: ## Tail all service logs
	docker compose logs -f --tail=50

gateway-logs: ## Tail gateway logs only
	docker compose logs -f --tail=100 gateway

ps: ## Show service status
	docker compose ps

psql: ## Open psql shell on Postgres
	docker compose exec postgres psql -U $${POSTGRES_USER:-trademaster} -d $${POSTGRES_DB:-trademaster}

questdb: ## Open the QuestDB web console
	@open http://localhost:9000 || xdg-open http://localhost:9000

migrate: ## Apply pending database migrations
	docker run --rm \
		-v $(PWD)/migrations:/migrations \
		--network trademaster_default \
		$(MIGRATE_IMAGE) \
		-path=/migrations \
		-database "$(DB_URL)" \
		up

migrate-down: ## Roll back the last migration
	docker run --rm \
		-v $(PWD)/migrations:/migrations \
		--network trademaster_default \
		$(MIGRATE_IMAGE) \
		-path=/migrations \
		-database "$(DB_URL)" \
		down 1

migrate-status: ## Show current migration version
	docker run --rm \
		-v $(PWD)/migrations:/migrations \
		--network trademaster_default \
		$(MIGRATE_IMAGE) \
		-path=/migrations \
		-database "$(DB_URL)" \
		version
