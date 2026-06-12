package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/shopos/inventory-service/internal/db"
	"github.com/shopos/inventory-service/internal/handlers"
	"github.com/shopos/inventory-service/internal/kafka"
)

func main() {
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "3004"
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer pool.Close()

	h := handlers.NewInventoryHandler(pool)

	router := mux.NewRouter()
	router.Handle("/metrics", promhttp.Handler())
	router.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"ready": "true", "service": "inventory-service"})
	}).Methods("GET")

	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "inventory-service"})
	}).Methods("GET")

	api := router.PathPrefix("/api/v1/inventory").Subrouter()
	api.HandleFunc("/{sku}", h.GetStock).Methods("GET")
	api.HandleFunc("/{sku}/availability", h.GetAvailability).Methods("GET")
	api.HandleFunc("/reserve", h.ReserveStock).Methods("POST")
	api.HandleFunc("/reserve/{reservationId}", h.ReleaseReservation).Methods("DELETE")
	api.HandleFunc("/confirm", h.ConfirmReservation).Methods("POST")
	api.HandleFunc("/{sku}/adjust", h.AdjustStock).Methods("PATCH")

	consumer := kafka.NewOrderConsumer(pool, os.Getenv("KAFKA_BROKERS"))
	go consumer.Run(ctx)

	srv := &http.Server{Addr: ":" + port, Handler: router}
	go func() {
		log.Printf("Inventory Service running on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	consumer.Close()
}
