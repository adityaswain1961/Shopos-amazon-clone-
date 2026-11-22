# syntax=docker/dockerfile:1.6
# Build from the monorepo root:  docker build -f apps/web/Dockerfile -t shopos/web .
FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
# Server-side renders call product-service directly: going through Kong would put
# every SSR request from this pod behind one per-IP rate limit.
ARG API_INTERNAL_URL=http://product-service:3003
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    API_INTERNAL_URL=${API_INTERNAL_URL}
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace=apps/web
RUN npm run build --workspace=apps/web

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# standalone output is traced from the monorepo root → server lives at apps/web/server.js
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER 1001:1001
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
