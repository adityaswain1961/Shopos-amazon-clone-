# ShopOS Service Level Objectives

## Availability

| Tier | Services | Target |
|------|----------|--------|
| Critical | auth, cart, order, payment, kong | **99.9%** monthly |
| Standard | product, inventory, user, search | **99.5%** monthly |
| Async | notification, analytics, recommendation | **99.0%** monthly |

## Latency (p99)

| Path | Target |
|------|--------|
| Auth login / refresh | < 150ms |
| Cart read/write | < 100ms |
| Product detail | < 200ms |
| Checkout (order create) | < 500ms |
| Search | < 300ms |

Prometheus alerts in `infrastructure/observability/prometheus/alerts.yml` fire when:

- 5xx error rate > 5% for 5 minutes
- p99 latency > 200ms for 10 minutes
- `up == 0` for 2 minutes

## Error budget

At 99.9% availability, ~43 minutes downtime per month is allowed per critical service.

## Runbooks

1. **HighErrorRate** — check Grafana → Loki logs filtered by `correlationId`, roll back latest deploy via ArgoCD/Helm.
2. **ServiceDown** — `kubectl get pods -n shopos`, inspect events and readiness probes.
3. **HighLatencyP99** — check Redis/Kafka lag, DB connection pool, HPA replica count.
