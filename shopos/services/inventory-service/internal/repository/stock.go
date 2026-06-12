package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type StockRow struct {
	ID        string `json:"id"`
	SKU       string `json:"sku"`
	Quantity  int    `json:"quantity"`
	Reserved  int    `json:"reserved"`
	Available int    `json:"available"`
}

type StockRepository struct {
	pool *pgxpool.Pool
}

func NewStockRepository(pool *pgxpool.Pool) *StockRepository {
	return &StockRepository{pool: pool}
}

func (r *StockRepository) GetBySKU(ctx context.Context, sku string) (*StockRow, error) {
	var row StockRow
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, sku, quantity, reserved, (quantity - reserved) as available FROM inventory WHERE sku = $1 LIMIT 1`,
		sku,
	).Scan(&row.ID, &row.SKU, &row.Quantity, &row.Reserved, &row.Available)
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *StockRepository) GetAvailable(ctx context.Context, sku string) (int, error) {
	var available int
	err := r.pool.QueryRow(ctx,
		`SELECT (quantity - reserved) FROM inventory WHERE sku = $1 LIMIT 1`, sku,
	).Scan(&available)
	return available, err
}

func (r *StockRepository) ReserveStock(ctx context.Context, cartID, sku string, quantity int, expiresAt time.Time) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var invID string
	var available int
	err = tx.QueryRow(ctx,
		`SELECT id::text, (quantity - reserved) FROM inventory WHERE sku = $1 FOR UPDATE`, sku,
	).Scan(&invID, &available)
	if err != nil {
		return "", fmt.Errorf("sku not found: %s", sku)
	}
	if available < quantity {
		return "", fmt.Errorf("insufficient stock")
	}

	_, err = tx.Exec(ctx, `UPDATE inventory SET reserved = reserved + $1 WHERE id = $2`, quantity, invID)
	if err != nil {
		return "", err
	}

	resID := uuid.New().String()
	_, err = tx.Exec(ctx,
		`INSERT INTO stock_reservations (id, cart_id, sku, quantity, expires_at, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
		resID, cartID, sku, quantity, expiresAt,
	)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return resID, nil
}

func (r *StockRepository) ReleaseReservation(ctx context.Context, reservationID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var sku string
	var qty int
	err = tx.QueryRow(ctx,
		`SELECT sku, quantity FROM stock_reservations WHERE id = $1 AND status = 'active' FOR UPDATE`, reservationID,
	).Scan(&sku, &qty)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `UPDATE inventory SET reserved = GREATEST(reserved - $1, 0) WHERE sku = $2`, qty, sku)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE stock_reservations SET status = 'released' WHERE id = $1`, reservationID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *StockRepository) ConfirmReservation(ctx context.Context, reservationID, orderID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var sku string
	var qty int
	err = tx.QueryRow(ctx,
		`SELECT sku, quantity FROM stock_reservations WHERE id = $1 AND status = 'active' FOR UPDATE`, reservationID,
	).Scan(&sku, &qty)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`UPDATE inventory SET quantity = quantity - $1, reserved = GREATEST(reserved - $1, 0) WHERE sku = $2`, qty, sku,
	)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`UPDATE stock_reservations SET status = 'confirmed', order_id = $2 WHERE id = $1`, reservationID, orderID,
	)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO stock_movements (sku, delta, reason, reference_id) VALUES ($1, $2, 'order', $3)`,
		sku, -qty, orderID,
	)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *StockRepository) AdjustStock(ctx context.Context, sku string, delta int, reason string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE inventory SET quantity = quantity + $1 WHERE sku = $2`, delta, sku,
	)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO stock_movements (sku, delta, reason) VALUES ($1, $2, $3)`, sku, delta, reason,
	)
	return err
}

func (r *StockRepository) ReserveForOrder(ctx context.Context, orderID, sku string, quantity int) error {
	_, err := r.ReserveStock(ctx, orderID, sku, quantity, time.Now().Add(30*time.Minute))
	return err
}

// ReleaseByOrder releases all active reservations for an order/cart id
func (r *StockRepository) ReleaseByOrder(ctx context.Context, orderID string) error {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text FROM stock_reservations WHERE (cart_id = $1 OR order_id = $1) AND status = 'active'`, orderID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		if err := r.ReleaseReservation(ctx, id); err != nil && err != pgx.ErrNoRows {
			return err
		}
	}
	return nil
}
