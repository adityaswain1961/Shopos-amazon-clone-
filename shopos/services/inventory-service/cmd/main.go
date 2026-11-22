package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/shopos/inventory-service/internal/db"
	"github.com/shopos/inventory-service/internal/handlers"
	"github.com/shopos/inventory-service/internal/kafka"
	"github.com/shopos/inventory-service/internal/repository"
)

func main() {
	_ = godotenv.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	port := getenv("PORT", "3004")
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := connectWithRetry(ctx, logger)
	if err != nil {
		logger.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	repo := repository.NewStockRepository(pool)
	h := handlers.NewInventoryHandler(repo, os.Getenv("INTERNAL_API_TOKEN"))

	var shuttingDown atomic.Bool

	router := mux.NewRouter()
	router.Handle("/metrics", promhttp.Handler())
	router.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true, "data": map[string]string{"status": "ok", "service": "inventory-service"},
		})
	}).Methods("GET")
	router.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		pingCtx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
		defer cancel()
		if shuttingDown.Load() || repo.Ping(pingCtx) != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"ready": false, "service": "inventory-service"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ready": true, "service": "inventory-service"})
	}).Methods("GET")

	api := router.PathPrefix("/api/v1/inventory").Subrouter()
	// Public, read-only (the gateway only routes GET to this service)
	api.HandleFunc("/{sku}", h.GetStock).Methods("GET")
	api.HandleFunc("/{sku}/availability", h.GetAvailability).Methods("GET")
	// Internal: service-to-service only, require X-Internal-Token
	api.HandleFunc("/reserve", h.RequireInternal(h.ReserveStock)).Methods("POST")
	api.HandleFunc("/reserve/{reservationId}", h.RequireInternal(h.ReleaseReservation)).Methods("DELETE")
	api.HandleFunc("/confirm", h.RequireInternal(h.ConfirmReservation)).Methods("POST")
	api.HandleFunc("/{sku}/adjust", h.RequireInternal(h.AdjustStock)).Methods("PATCH")

	// ─── Saga consumer ───────────────────────────────────────────────
	ttl := time.Duration(envInt("RESERVATION_TTL_MINUTES", 30)) * time.Minute
	consumer, err := kafka.NewOrderConsumer(repo, getenv("KAFKA_BROKERS", "localhost:9092"), ttl, logger)
	if err != nil {
		logger.Error("kafka consumer init failed", "err", err)
		os.Exit(1)
	}
	consumerDone := make(chan struct{})
	go func() {
		defer close(consumerDone)
		if err := consumer.Run(ctx); err != nil {
			logger.Error("kafka consumer stopped", "err", err)
		}
	}()

	// ─── Reservation expiry sweeper (safe on every replica) ──────────
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := repo.ExpireReservations(ctx, 500)
				if err != nil {
					logger.Warn("reservation sweep failed", "err", err)
				} else if n > 0 {
					logger.Info("expired stale reservations", "inventoryRows", n)
				}
			}
		}
	}()

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		logger.Info("inventory-service listening", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server error", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutdown signal received; draining")
	shuttingDown.Store(true)
	time.Sleep(time.Duration(envInt("SHUTDOWN_DRAIN_SECONDS", 5)) * time.Second)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	<-consumerDone
	consumer.Close()
	logger.Info("shutdown complete")
}

func connectWithRetry(ctx context.Context, logger *slog.Logger) (*pgxpool.Pool, error) {
	var lastErr error
	for attempt := 1; attempt <= 30; attempt++ {
		pool, err := db.Connect(ctx)
		if err == nil {
			return pool, nil
		}
		lastErr = err
		logger.Warn("database not ready, retrying", "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, lastErr
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
