# HashiCorp Vault — ShopOS

## Secret paths

| Path | Keys |
|------|------|
| `shopos/data/shared` | `KAFKA_BROKERS`, `REDIS_URL` |
| `shopos/data/auth` | `JWT_PRIVATE_KEY`, `MONGO_URI` |
| `shopos/data/payment` | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY` |

## Bootstrap (dev)

```bash
vault secrets enable -path=shopos kv-v2
vault kv put shopos/shared KAFKA_BROKERS=kafka:29092
vault policy write shopos infrastructure/vault/policies/shopos.hcl
```

## Kubernetes auth

Use Vault Agent Injector annotations on deployments:

```yaml
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "shopos"
  vault.hashicorp.com/agent-inject-secret-config: "shopos/data/auth"
```

Never commit real secrets. Use `secrets.example.yaml` or Sealed Secrets for K8s.
