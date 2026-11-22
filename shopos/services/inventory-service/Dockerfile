# syntax=docker/dockerfile:1.6
FROM golang:1.22-alpine AS builder
WORKDIR /app
# confluent-kafka-go links librdkafka via cgo
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# `-tags musl` selects the bundled librdkafka build for Alpine/musl.
RUN CGO_ENABLED=1 go build -tags musl -trimpath -ldflags="-s -w" -o inventory-service ./cmd

FROM alpine:3.19
RUN apk add --no-cache ca-certificates && addgroup -g 1001 -S app && adduser -S app -u 1001 -G app
WORKDIR /app
COPY --from=builder /app/inventory-service .
# numeric uid: Kubernetes runAsNonRoot cannot verify a named user
USER 1001:1001
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3004/health || exit 1
CMD ["./inventory-service"]
