FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/order-service-*.jar app.jar
EXPOSE 3007
ENTRYPOINT ["java", "-jar", "app.jar"]
