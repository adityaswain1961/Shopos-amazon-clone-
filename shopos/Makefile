.PHONY: up up-web down logs build clean infra db-migrate verify loadtest-smoke jwt-key

COMPOSE := docker compose

## Full stack (API gateway on http://localhost:8000)
up:
	$(COMPOSE) up -d --build

## Full stack + Next.js storefront on http://localhost:3000
up-web:
	$(COMPOSE) --profile frontend up -d --build

## Only data stores + Kafka (run services from your IDE)
infra:
	$(COMPOSE) up -d postgres mongodb redis kafka kafka-init elasticsearch

down:
	$(COMPOSE) --profile frontend down

logs:
	$(COMPOSE) logs -f --tail=100

build:
	$(COMPOSE) --profile frontend build

## Destroys all local data volumes
clean:
	$(COMPOSE) --profile frontend down -v

## Apply shared-schema SQL migrations to an existing database:
##   make db-migrate DATABASE_URL=postgresql://user:pass@host:5432/shopos_db
db-migrate:
	@test -n "$(DATABASE_URL)" || (echo "DATABASE_URL is required" && exit 1)
	@for f in infrastructure/db/migrations/*.sql; do echo "applying $$f"; psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f $$f || exit 1; done
	cd services/product-service && DATABASE_URL="$(DATABASE_URL)" npx prisma migrate deploy

## Compile + test every Node workspace (what CI runs for Node)
verify:
	npm ci
	npm run build:packages
	npm run build:services
	npm run test

## Small local load test against the compose stack (needs k6 installed)
loadtest-smoke:
	k6 run -e BASE_URL=http://localhost:8000 -e PEAK_RPS=50 -e HOLD=1m loadtest/storefront.js

## Generate an RS256 signing key for auth-service (shared by all replicas)
jwt-key:
	openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
	@echo "Set JWT_PRIVATE_KEY to the contents of jwt-private.pem (keep it secret, never commit it)"
