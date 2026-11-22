# ShopOS Infrastructure

| Path | Description |
|------|-------------|
| `db/init.sql` | PostgreSQL bootstrap for a **fresh** database (shared tables, hot-path indexes, outbox) |
| `db/migrations/` | Idempotent upgrades for **existing** databases (`make db-migrate`) |
| `kafka/topics.yaml` | Topic catalog and saga flow |
| `kafka/create-topics.sh` | Creates topics + DLQs with explicit partitions (compose `kafka-init`) |
| `helm/shopos/` | Helm chart: deployments, HPA, PDB, network policy, migration/topic hook jobs |
| `helm/kong-values.yaml` | Values for the official Kong chart (DB-less, uses `kong/kong.yml`) |
| `k8s/namespaces/` | Namespace manifest |
| `k8s/secrets/` | `secrets.example.yaml` template only — never commit real values |
| `observability/` | Prometheus (+ alerts), Grafana, Loki, Promtail, OTel collector, Alertmanager |
| `vault/` | Vault policies and secret path documentation |
| `argocd/` | GitOps Application manifest |
| `SLO.md` | Availability and latency targets |

Capacity planning and the low-cost hosting plan are in [`../docs/SCALING.md`](../docs/SCALING.md).
