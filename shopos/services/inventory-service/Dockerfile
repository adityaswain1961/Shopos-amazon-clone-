FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN go mod tidy && CGO_ENABLED=1 go build -o inventory-service ./cmd

FROM alpine:3.19
RUN apk add --no-cache ca-certificates libc6-compat
WORKDIR /app
COPY --from=builder /app/inventory-service .
EXPOSE 3004
CMD ["./inventory-service"]
