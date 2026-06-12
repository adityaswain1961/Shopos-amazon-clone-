# ShopOS Infrastructure

| Path | Description |
|------|-------------|
| `db/init.sql` | PostgreSQL bootstrap (orders, inventory, payments, etc.) |
| `kafka/topics.yaml` | Kafka topic catalog |
| `observability/` | Prometheus, Grafana, Loki, Jaeger, OTel configs |
| `k8s/` | Raw Kubernetes manifests (namespace, HPA, network policies) |
| `helm/shopos/` | Helm chart for all microservices |
| `vault/` | Vault policies and secret path documentation |
| `argocd/` | GitOps Application manifest |
| `SLO.md` | Availability and latency targets |

## Layout

```
infrastructure/
├── observability/
│   ├── prometheus/     # scrape config + alert rules
│   ├── grafana/        # datasources + ShopOS dashboard
│   ├── loki/           # log aggregation
│   ├── promtail/       # Docker log shipping
│   ├── otel-collector/ # traces + metrics pipeline
│   └── alertmanager/   # alert routing
├── k8s/
│   ├── namespaces/
│   ├── configmaps/
│   ├── secrets/        # secrets.example.yaml only
│   ├── deployments/
│   ├── ingress/
│   ├── hpa/
│   └── network-policies/
├── helm/shopos/
└── vault/
```
