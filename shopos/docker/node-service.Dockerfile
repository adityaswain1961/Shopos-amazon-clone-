# syntax=docker/dockerfile:1.6
#
# One image recipe for every Node/TypeScript service in the monorepo.
# Build from the repo root (shopos/) so workspace packages are available:
#
#   docker build -f docker/node-service.Dockerfile \
#     --build-arg SERVICE=auth-service --build-arg PORT=3001 -t shopos/auth-service .
#
ARG NODE_IMAGE=node:20-alpine

# ─── 1. build: install all deps for this service + shared packages, compile TS ──
FROM ${NODE_IMAGE} AS build
ARG SERVICE
WORKDIR /app
# Prisma engines link against OpenSSL, which node:alpine does not include
RUN apk add --no-cache openssl
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund \
      --workspace=packages/shared-types --workspace=packages/observability \
      --workspace=packages/kafka-client --workspace=packages/jwt-verifier \
      --workspace=services/${SERVICE} \
 && npm run build --workspace=packages/shared-types \
 && npm run build --workspace=packages/observability \
 && npm run build --workspace=packages/kafka-client \
 && npm run build --workspace=packages/jwt-verifier \
 && npm run build --workspace=services/${SERVICE} \
 && mkdir -p node_modules/.prisma services/${SERVICE}/prisma

# ─── 2. prod-deps: production dependencies only ─────────────────────
FROM ${NODE_IMAGE} AS prod-deps
ARG SERVICE
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
      --workspace=packages/shared-types --workspace=packages/observability \
      --workspace=packages/kafka-client --workspace=packages/jwt-verifier \
      --workspace=services/${SERVICE}

# ─── 3. runtime ─────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ARG SERVICE
ARG PORT=3000
ENV NODE_ENV=production \
    SERVICE=${SERVICE} \
    PORT=${PORT} \
    # bcrypt / sharp / crypto run on libuv's threadpool (default 4)
    UV_THREADPOOL_SIZE=8
RUN apk add --no-cache tini openssl && addgroup -g 1001 -S app && adduser -S app -u 1001 -G app
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/${SERVICE}/package.json ./services/${SERVICE}/package.json
COPY --from=build /app/services/${SERVICE}/dist ./services/${SERVICE}/dist
# Prisma client + engine generated at build time (no-op dir for other services)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/services/${SERVICE}/prisma ./services/${SERVICE}/prisma

# numeric uid: Kubernetes runAsNonRoot cannot verify a named user
USER 1001:1001
EXPOSE ${PORT}
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
# tini reaps zombies and forwards SIGTERM so graceful shutdown actually runs
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "exec node services/${SERVICE}/dist/app.js"]
