package db

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	host := getenv("DB_HOST", "localhost")
	port := getenv("DB_PORT", "5432")
	user := getenv("DB_USER", "shopos_admin")
	password := getenv("DB_PASSWORD", "shopos_password")
	name := getenv("DB_NAME", "shopos_db")

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s", user, password, host, port, name)
	return pgxpool.New(ctx, dsn)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
