# syntax=docker/dockerfile:1.6
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml .
# Cache dependencies in their own layer: source edits don't re-download Maven Central.
RUN --mount=type=cache,target=/root/.m2 mvn -q -B dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -g 1001 -S app && adduser -S app -u 1001 -G app
WORKDIR /app
COPY --from=builder /app/target/order-service-*.jar app.jar
# numeric uid: Kubernetes runAsNonRoot cannot verify a named user
USER 1001:1001
EXPOSE 3007
# Size the heap from the container limit, not the node's RAM.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Djava.security.egd=file:/dev/./urandom"
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3007/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
