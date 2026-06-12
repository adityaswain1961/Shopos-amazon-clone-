# ShopOS services read secrets under shopos/data/*
path "shopos/data/auth/*" {
  capabilities = ["read"]
}

path "shopos/data/user/*" {
  capabilities = ["read"]
}

path "shopos/data/product/*" {
  capabilities = ["read"]
}

path "shopos/data/payment/*" {
  capabilities = ["read"]
}

path "shopos/data/shared/*" {
  capabilities = ["read"]
}

# CI/CD can renew tokens
path "auth/token/renew-self" {
  capabilities = ["update"]
}
