# syntax=docker/dockerfile:1.6
FROM rust:1.85-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Build dependencies in their own cached layer
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release --locked && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 1001 app
COPY --from=builder /app/target/release/cart-service /app/cart-service
# numeric uid: Kubernetes runAsNonRoot cannot verify a named user
USER 1001
EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3006/health || exit 1
CMD ["/app/cart-service"]
