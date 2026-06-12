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

# Copy user service
COPY services/user-service/package.json ./services/user-service/
COPY services/user-service/tsconfig.json ./services/user-service/
COPY services/user-service/src ./services/user-service/src

# Install all dependencies (including devDependencies for build)
RUN npm ci --workspace=packages/shared-types --workspace=services/user-service

# Build shared types first, then user service
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=services/user-service

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

# Copy user service build output
COPY --from=builder /app/services/user-service/package.json ./services/user-service/
COPY --from=builder /app/services/user-service/dist ./services/user-service/dist

# Install production dependencies only
RUN npm ci --workspace=packages/shared-types --workspace=services/user-service --omit=dev

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

# Start the service
CMD ["node", "services/user-service/dist/app.js"]
