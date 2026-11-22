package db

import (
	"context"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect builds a bounded connection pool. Prefer DATABASE_URL (pointing at
// PgBouncer in production); falls back to the DB_* variables.
func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		u := url.URL{
			Scheme: "postgres",
			User:   url.UserPassword(getenv("DB_USER", "shopos_admin"), getenv("DB_PASSWORD", "shopos_password")),
			Host:   getenv("DB_HOST", "localhost") + ":" + getenv("DB_PORT", "5432"),
			Path:   "/" + getenv("DB_NAME", "shopos_db"),
		}
		dsn = u.String()
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	// Per-pod pool; total connections = replicas x DB_POOL_MAX.
	cfg.MaxConns = int32(envInt("DB_POOL_MAX", 20))
	cfg.MinConns = int32(envInt("DB_POOL_MIN", 2))
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second
	cfg.ConnConfig.RuntimeParams["application_name"] = "inventory-service"

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return fallback
}
