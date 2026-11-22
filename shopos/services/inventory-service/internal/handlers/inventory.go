package handlers

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/jackc/pgx/v5"
	"github.com/shopos/inventory-service/internal/repository"
)

type InventoryHandler struct {
	repo          *repository.StockRepository
	internalToken string
}

// NewInventoryHandler: internalToken protects stock-mutating endpoints. They
// are meant for other services (and are not routed by the public gateway);
// if no token is configured they are disabled entirely.
func NewInventoryHandler(repo *repository.StockRepository, internalToken string) *InventoryHandler {
	return &InventoryHandler{repo: repo, internalToken: internalToken}
}

type apiResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data"`
	Error   *string     `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, data interface{}, errMsg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := apiResponse{Success: errMsg == "", Data: data}
	if errMsg != "" {
		resp.Error = &errMsg
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// RequireInternal wraps a handler so only callers holding the shared internal token get through.
func (h *InventoryHandler) RequireInternal(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("X-Internal-Token")
		if h.internalToken == "" || subtle.ConstantTimeCompare([]byte(got), []byte(h.internalToken)) != 1 {
			writeJSON(w, http.StatusForbidden, nil, "forbidden")
			return
		}
		next(w, r)
	}
}

func decode(r *http.Request, v interface{}) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 16<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func (h *InventoryHandler) GetStock(w http.ResponseWriter, r *http.Request) {
	sku := mux.Vars(r)["sku"]
	stock, err := h.repo.GetBySKU(r.Context(), sku)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, nil, "sku not found")
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, nil, "internal error")
		return
	}
	// Stock changes often; let the CDN/gateway absorb bursts for a few seconds.
	w.Header().Set("Cache-Control", "public, max-age=5, s-maxage=5")
	writeJSON(w, http.StatusOK, stock, "")
}

func (h *InventoryHandler) GetAvailability(w http.ResponseWriter, r *http.Request) {
	sku := mux.Vars(r)["sku"]
	stock, err := h.repo.GetBySKU(r.Context(), sku)
	if errors.Is(err, pgx.ErrNoRows) {
		w.Header().Set("Cache-Control", "public, max-age=5, s-maxage=5")
		writeJSON(w, http.StatusOK, map[string]interface{}{"sku": sku, "available": 0, "inStock": false}, "")
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, nil, "internal error")
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=5, s-maxage=5")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sku": sku, "available": stock.Available, "inStock": stock.Available > 0,
	}, "")
}

type reserveRequest struct {
	CartID   string `json:"cartId"`
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

func (h *InventoryHandler) ReserveStock(w http.ResponseWriter, r *http.Request) {
	var req reserveRequest
	if err := decode(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, nil, "invalid body")
		return
	}
	id, err := h.repo.ReserveStock(r.Context(), req.CartID, req.SKU, req.Quantity, time.Now().Add(15*time.Minute))
	switch {
	case errors.Is(err, repository.ErrInvalidItems):
		writeJSON(w, http.StatusBadRequest, nil, err.Error())
	case errors.Is(err, repository.ErrInsufficientStock):
		writeJSON(w, http.StatusConflict, nil, "insufficient stock")
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, nil, "internal error")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"reservationId": id}, "")
	}
}

func (h *InventoryHandler) ReleaseReservation(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["reservationId"]
	err := h.repo.ReleaseReservation(r.Context(), id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		writeJSON(w, http.StatusNotFound, nil, "reservation not found or not active")
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, nil, "internal error")
	default:
		writeJSON(w, http.StatusOK, nil, "")
	}
}

type confirmRequest struct {
	OrderID       string `json:"orderId"`
	ReservationID string `json:"reservationId"`
}

func (h *InventoryHandler) ConfirmReservation(w http.ResponseWriter, r *http.Request) {
	var req confirmRequest
	if err := decode(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, nil, "invalid body")
		return
	}
	err := h.repo.ConfirmReservation(r.Context(), req.ReservationID, req.OrderID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		writeJSON(w, http.StatusNotFound, nil, "reservation not found or not active")
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, nil, "internal error")
	default:
		writeJSON(w, http.StatusOK, nil, "")
	}
}

type adjustRequest struct {
	Delta  int    `json:"delta"`
	Reason string `json:"reason"`
}

func (h *InventoryHandler) AdjustStock(w http.ResponseWriter, r *http.Request) {
	sku := mux.Vars(r)["sku"]
	var req adjustRequest
	if err := decode(r, &req); err != nil || req.Reason == "" || len(req.Reason) > 50 {
		writeJSON(w, http.StatusBadRequest, nil, "body must be {delta:int, reason:string<=50}")
		return
	}
	err := h.repo.AdjustStock(r.Context(), sku, req.Delta, req.Reason)
	switch {
	case errors.Is(err, repository.ErrInvalidItems):
		writeJSON(w, http.StatusBadRequest, nil, "invalid sku or delta")
	case errors.Is(err, pgx.ErrNoRows):
		writeJSON(w, http.StatusNotFound, nil, "sku not found")
	case err != nil:
		// most likely the CHECK constraint: stock would go negative / below reserved
		writeJSON(w, http.StatusConflict, nil, "adjustment rejected: stock would become inconsistent")
	default:
		writeJSON(w, http.StatusOK, nil, "")
	}
}
