.PHONY: up down db-up logs build clean

# Bring up infrastructure only (Databases, Kafka, Redis, Kong)
db-up:
	docker-compose up -d

# Bring up the entire stack including all microservices and frontend
up:
	docker-compose --profile apps up -d --build

# Stop everything
down:
	docker-compose --profile apps down

# Tail logs for everything
logs:
	docker-compose --profile apps logs -f

# Force rebuild of all microservices
build:
	docker-compose --profile apps build --no-cache

# Clean up dangling volumes and networks
clean:
	docker-compose --profile apps down -v
