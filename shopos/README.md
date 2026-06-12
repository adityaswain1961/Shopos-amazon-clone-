# ShopOS

Amazon-scale e-commerce microservices monorepo.

## Quick start (Docker)

```bash
cd shopos
cp .env.example .env   # edit passwords before production
docker compose up -d --build
```

API Gateway: http://localhost:8000

| Service | Port | Health | Metrics |
|---------|------|--------|---------|
| Kong Gateway | 8000 / 8001 (admin) | `/health` via kong health | `:8001/metrics` |
| Auth | 3001 | `/health` | `/metrics` |
| User | 3002 | `/health` | `/metrics` |
| Product | 3003 | `/health` | `/metrics` |
| Inventory | 3004 | `/health` | `/metrics` |
| Review | 3005 | `/health` | — |
| Cart | 3006 | `/health` | — |
| Order | 3007 | `/health` | `/actuator/prometheus` |
| Payment | 3008 | `/health` | `/metrics` |
| Coupon | 3009 | `/health` | — |
| Search (discovery) | 3010 | `/health` | — |
| Notification | 3013 | `/health` | — |
| Analytics / AI Help | 3014 | `/health` | — |

## Observability stack

Start Prometheus, Grafana, Loki, Jaeger, and OpenTelemetry Collector:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up -d
# or
npm run observability:up
```

| UI | URL | Default login |
|----|-----|----------------|
| Grafana | http://localhost:3030 | admin / `shopos_grafana` |
| Prometheus | http://localhost:9090 | — |
| Jaeger | http://localhost:16686 | — |
| Alertmanager | http://localhost:9093 | — |

SLOs and alert rules: `infrastructure/SLO.md`, `infrastructure/observability/prometheus/alerts.yml`.

## Production compose

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d
```

Secrets must come from `.env` (dev) or **HashiCorp Vault** / K8s Sealed Secrets (prod). See `infrastructure/vault/README.md`.

## Kubernetes & Helm

```bash
kubectl apply -f infrastructure/k8s/namespaces/
kubectl apply -f infrastructure/k8s/configmaps/
# Create secrets from infrastructure/k8s/secrets/secrets.example.yaml (do not commit real values)

helm upgrade --install shopos ./infrastructure/helm/shopos \
  --namespace shopos --create-namespace \
  -f ./infrastructure/helm/shopos/values.yaml
```

Network policies (default-deny ingress): `infrastructure/k8s/network-policies/`.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): lint, test Node services, build & push images, Trivy scan.
- **Deploy** (`.github/workflows/deploy.yml`): Helm upgrade to cluster (requires `KUBE_CONFIG` secret).

## Saga flow (checkout)

1. `POST /api/v1/orders` → publishes `order.created`
2. Inventory consumes → reserves stock → `inventory.confirmed`
3. Order saga → `payment.initiate`
4. Payment consumes → `payment.completed` or `payment.failed`
5. Order saga → `order.confirmed` or `inventory.release` (compensation)
6. Notification consumes → emails

## Kong gateway hardening

- `X-Correlation-Id` injected on every request
- Global rate limiting (300 req/min; auth routes 60 req/min)
- Prometheus metrics on admin port `:8001`

## Shared packages

| Package | Purpose |
|---------|---------|
| `@shopos/shared-types` | API + Kafka envelopes |
| `@shopos/kafka-client` | Event builder/publisher |
| `@shopos/observability` | Prometheus metrics + `/ready` |
| `@shopos/jwt-verifier` | JWKS JWT middleware |

## Frontend (Next.js)

```bash
cd apps/web
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000 — API calls go to Kong (`NEXT_PUBLIC_API_URL`).

## Local dev (Node services)

```bash
npm install
npm run build:shared-types
npm run build:observability
docker compose up -d postgres mongodb redis kafka
npm run dev:auth
npm run dev:product
```

## Database

PostgreSQL init: `infrastructure/db/init.sql`. Product schema: `services/product-service/prisma/schema.prisma`.
