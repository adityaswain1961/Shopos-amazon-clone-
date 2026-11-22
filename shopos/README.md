# ShopOS

E-commerce platform built as polyglot microservices (Node/TypeScript, Go, Rust, Java, C#, Python) behind a Kong gateway, designed to scale horizontally and run cheaply.

- **Scaling and cost plan (start here):** [docs/SCALING.md](docs/SCALING.md)
- **SLOs and alerts:** [infrastructure/SLO.md](infrastructure/SLO.md)

## Quick start

```bash
cd shopos
cp .env.example .env          # defaults work for local dev
make up                       # API gateway → http://localhost:8000
make up-web                   # + storefront → http://localhost:3000
```

On first start, compose runs `kafka-init` (creates topics) and `product-migrate` (Prisma migrations) before the services.

| Service | Port | Language | Store | Health / Ready |
|---|---|---|---|---|
| Kong gateway | 8000 | — | — | `kong health` |
| auth | 3001 | Node | MongoDB, Redis | `/health`, `/ready` |
| user | 3002 | Node | MongoDB, Redis | `/health`, `/ready` |
| product | 3003 | Node (Prisma) | Postgres, Redis | `/health`, `/ready` |
| inventory | 3004 | Go | Postgres | `/health`, `/ready` |
| review | 3005 | Node | Postgres | `/health`, `/ready` |
| cart | 3006 | Rust | Redis | `/health`, `/ready` |
| order | 3007 | Java 21 (Spring) | Postgres | `/health`, `/actuator/health/readiness` |
| payment | 3008 | C# (.NET 8) | Postgres | `/health`, `/ready` |
| coupon | 3009 | Node | Postgres, Redis | `/health`, `/ready` |
| discovery (search) | 3010 | Python | Elasticsearch | `/health`, `/ready` |
| notification | 3013 | Node | Redis | `/health`, `/ready` |
| analytics / AI help | 3014 | Python | Postgres | `/health`, `/ready` |

## Checkout saga

Orchestrated by order-service; all events are keyed by `orderId` and every handler is idempotent.

1. `POST /api/v1/orders` (JWT + `Idempotency-Key`). Prices come from the catalog, never from the client. The order and `order.created` are committed together via the **transactional outbox**.
2. inventory reserves stock (all-or-nothing) → `inventory.confirmed` or `inventory.failed`.
3. order → `payment.initiate` (server-computed amount) → payment → `payment.completed` / `payment.failed`.
4. order → `order.confirmed` (inventory commits stock; notification emails) or `inventory.release` + `order.cancelled`.
5. Abandoned payments time out after 20 minutes. A payment that arrives for an already-cancelled order is refunded automatically.

`PAYMENT_MODE=mock` (dev default) approves every payment instantly. Production requires `stripe`.

## Repository layout

```
apps/web                    Next.js 15 storefront (ISR product pages)
services/*                  microservices (see table)
packages/*                  shared TS: types, kafka-client, observability, jwt-verifier
docker/node-service.Dockerfile   one image recipe for all Node services
kong/kong.yml               gateway: CORS, rate limits, micro-cache, routing
infrastructure/db           init.sql (fresh DB) + migrations/ (existing DB)
infrastructure/kafka        topic catalog + create-topics.sh
infrastructure/helm         Helm chart (+ kong-values.yaml for the Kong chart)
infrastructure/observability  Prometheus, Grafana, Loki, OTel configs
loadtest/storefront.js      k6 traffic model with SLO thresholds
```

## Development

```bash
npm install
npm run build:packages        # shared workspace packages
npm run build:services        # type-check / compile all Node services
npm test                      # auth, user, product test suites
make infra                    # just the datastores + Kafka
npm run dev:product           # run one service locally
```

CI (`.github/workflows/ci.yml` at the repo root) compiles every language: Node, Next.js, Go, Rust, Java, .NET and Python. It also lints and renders the Helm chart, then builds and pushes images.

## Production

- **Kubernetes:** see the rollout checklist in [docs/SCALING.md](docs/SCALING.md#6-rollout-checklist).
- **Single host:** `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d`. This adds PgBouncer, requires secrets, and hides internal ports.
- **Secrets:** `JWT_PRIVATE_KEY` (shared by all auth replicas), `INTERNAL_API_TOKEN`, DB passwords, and Stripe keys. Template: `infrastructure/k8s/secrets/secrets.example.yaml`.
- **Existing databases:** `make db-migrate DATABASE_URL=...` applies `infrastructure/db/migrations/*.sql` and Prisma migrations.

## Observability

```bash
npm run observability:up      # Prometheus :9090, Grafana :3030, Jaeger :16686, Alertmanager :9093
```
