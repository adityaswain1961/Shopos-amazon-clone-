package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopos/inventory-service/internal/repository"
)

type InventoryHandler struct {
	repo *repository.StockRepository
}

func NewInventoryHandler(pool *pgxpool.Pool) *InventoryHandler {
	return &InventoryHandler{repo: repository.NewStockRepository(pool)}
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (h *InventoryHandler) GetStock(w http.ResponseWriter, r *http.Request) {
	sku := mux.Vars(r)["sku"]
	stock, err := h.repo.GetBySKU(r.Context(), sku)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": stock})
}

func (h *InventoryHandler) GetAvailability(w http.ResponseWriter, r *http.Request) {
	sku := mux.Vars(r)["sku"]
	available, err := h.repo.GetAvailable(r.Context(), sku)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": map[string]int{"available": available}})
}

type reserveRequest struct {
	CartID    string `json:"cartId"`
	SKU       string `json:"sku"`
	Quantity  int    `json:"quantity"`
}

func (h *InventoryHandler) ReserveStock(w http.ResponseWriter, r *http.Request) {
	var req reserveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "invalid body"})
		return
	}
	reservationID, err := h.repo.ReserveStock(r.Context(), req.CartID, req.SKU, req.Quantity, time.Now().Add(15*time.Minute))
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": map[string]string{"reservationId": reservationID}})
}

func (h *InventoryHandler) ReleaseReservation(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["reservationId"]
	if err := h.repo.ReleaseReservation(r.Context(), id); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": nil})
}

type confirmRequest struct {
	OrderID       string `json:"orderId"`
	ReservationID string `json:"reservationId"`
}

func (h *InventoryHandler) ConfirmReservation(w http.ResponseWriter, r *http.Request) {
	var req confirmRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "invalid body"})
		return
	}
	if err := h.repo.ConfirmReservation(r.Context(), req.ReservationID, req.OrderID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": nil})
}

type adjustRequest struct {
	Delta  int    `json:"delta"`
	Reason string `json:"reason"`
}

func (h *InventoryHandler) AdjustStock(w http.ResponseWriter, r *http.Request) {
	sku := mux.Vars(r)["sku"]
	var req adjustRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "invalid body"})
		return
	}
	if err := h.repo.AdjustStock(r.Context(), sku, req.Delta, req.Reason); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": nil})
}
