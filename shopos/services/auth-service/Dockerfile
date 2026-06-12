# ─── Stage 1: Builder ────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy shared packages
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/shared-types/src ./packages/shared-types/src
COPY packages/observability/package.json ./packages/observability/
COPY packages/observability/tsconfig.json ./packages/observability/
COPY packages/observability/src ./packages/observability/src
COPY packages/jwt-verifier/package.json ./packages/jwt-verifier/
COPY packages/jwt-verifier/tsconfig.json ./packages/jwt-verifier/
COPY packages/jwt-verifier/src ./packages/jwt-verifier/src

# Copy auth service
COPY services/auth-service/package.json ./services/auth-service/
COPY services/auth-service/tsconfig.json ./services/auth-service/
COPY services/auth-service/src ./services/auth-service/src

# Install all dependencies (including devDependencies for build)
RUN npm ci --workspace=packages/shared-types --workspace=packages/observability --workspace=packages/jwt-verifier --workspace=services/auth-service

# Build shared packages first, then auth service
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=packages/observability
RUN npm run build --workspace=packages/jwt-verifier
RUN npm run build --workspace=services/auth-service

# ─── Stage 2: Runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy shared-types build output
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/jwt-verifier/dist ./packages/jwt-verifier/dist

# Copy auth service build output
COPY --from=builder /app/services/auth-service/package.json ./services/auth-service/
COPY --from=builder /app/services/auth-service/dist ./services/auth-service/dist

# Install production dependencies only
RUN npm ci --workspace=packages/shared-types --workspace=packages/observability --workspace=packages/jwt-verifier --workspace=services/auth-service --omit=dev

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the service
CMD ["node", "services/auth-service/dist/app.js"]
