FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY services/product-service ./services/product-service
RUN npm ci --workspace=packages/shared-types --workspace=services/product-service 2>/dev/null || npm install --workspace=packages/shared-types --workspace=services/product-service
RUN npm run build --workspace=packages/shared-types
WORKDIR /app/services/product-service
RUN npx prisma generate && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/product-service/dist ./dist
COPY --from=builder /app/services/product-service/node_modules ./node_modules
COPY --from=builder /app/services/product-service/package.json ./
COPY --from=builder /app/services/product-service/prisma ./prisma
ENV NODE_ENV=production
EXPOSE 3003
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/app.js"]
