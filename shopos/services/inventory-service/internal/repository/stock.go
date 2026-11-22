package repository

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrInsufficientStock means the order cannot be fulfilled right now.
	ErrInsufficientStock = errors.New("insufficient stock")
	// ErrInvalidItems means the request itself is malformed (no items, bad qty).
	ErrInvalidItems = errors.New("invalid items")
)

// ReservationState is the outcome of ReserveForOrder.
type ReservationState int

const (
	StateReserved        ReservationState = iota // newly reserved in this call
	StateAlreadyReserved                         // a previous delivery already reserved it
	StateAlreadyReleased                         // order was reserved before and since released/expired
)

type StockRow struct {
	SKU       string `json:"sku"`
	Quantity  int    `json:"quantity"`
	Reserved  int    `json:"reserved"`
	Available int    `json:"available"`
}

type Item struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

type StockRepository struct {
	pool *pgxpool.Pool
}

func NewStockRepository(pool *pgxpool.Pool) *StockRepository {
	return &StockRepository{pool: pool}
}

func (r *StockRepository) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

// GetBySKU aggregates stock across all warehouses.
func (r *StockRepository) GetBySKU(ctx context.Context, sku string) (*StockRow, error) {
	var row StockRow
	err := r.pool.QueryRow(ctx, `
		SELECT sku, COALESCE(SUM(quantity), 0)::int, COALESCE(SUM(reserved), 0)::int
		  FROM inventory WHERE sku = $1 GROUP BY sku`, sku,
	).Scan(&row.SKU, &row.Quantity, &row.Reserved)
	if err != nil {
		return nil, err
	}
	row.Available = row.Quantity - row.Reserved
	return &row, nil
}

// normalize merges duplicate SKUs and sorts them. Locking rows in a stable
// order across all transactions prevents deadlocks between concurrent orders.
func normalize(items []Item) ([]Item, error) {
	merged := map[string]int{}
	for _, it := range items {
		if it.SKU == "" || it.Quantity <= 0 || it.Quantity > 10000 {
			return nil, fmt.Errorf("%w: %q x%d", ErrInvalidItems, it.SKU, it.Quantity)
		}
		merged[it.SKU] += it.Quantity
	}
	if len(merged) == 0 {
		return nil, fmt.Errorf("%w: order has no items", ErrInvalidItems)
	}
	out := make([]Item, 0, len(merged))
	for sku, q := range merged {
		out = append(out, Item{SKU: sku, Quantity: q})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SKU < out[j].SKU })
	return out, nil
}

// reserveOne atomically reserves qty of sku from the warehouse with the most
// free stock. The WHERE clause is re-checked by Postgres after any row-lock
// wait, so two concurrent orders can never both take the last unit; the
// CHECK (reserved <= quantity) constraint is the final backstop.
func reserveOne(ctx context.Context, tx pgx.Tx, sku string, qty int) (string, *string, error) {
	for attempt := 0; attempt < 3; attempt++ {
		var invID string
		var whID *string
		err := tx.QueryRow(ctx, `
			UPDATE inventory SET reserved = reserved + $2
			 WHERE id = (SELECT id FROM inventory
			              WHERE sku = $1 AND quantity - reserved >= $2
			              ORDER BY quantity - reserved DESC
			              LIMIT 1)
			   AND quantity - reserved >= $2
			RETURNING id::text, warehouse_id::text`, sku, qty,
		).Scan(&invID, &whID)
		if err == nil {
			return invID, whID, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", nil, err
		}
		// Either genuinely out of stock, or we lost a race for that row.
		var best int
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(MAX(quantity - reserved), 0) FROM inventory WHERE sku = $1`, sku,
		).Scan(&best); err != nil {
			return "", nil, err
		}
		if best < qty {
			return "", nil, fmt.Errorf("%w: %s", ErrInsufficientStock, sku)
		}
	}
	return "", nil, fmt.Errorf("%w: %s (high contention)", ErrInsufficientStock, sku)
}

// ReserveForOrder reserves every item of an order, all-or-nothing, and is
// idempotent per order id (safe under Kafka redelivery).
func (r *StockRepository) ReserveForOrder(ctx context.Context, orderID string, items []Item, ttl time.Duration) (ReservationState, error) {
	norm, err := normalize(items)
	if err != nil {
		return StateReserved, err
	}

	var live, total int
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status IN ('active', 'confirmed')), COUNT(*)
		  FROM stock_reservations WHERE order_id = $1`, orderID,
	).Scan(&live, &total); err != nil {
		return StateReserved, err
	}
	if live > 0 {
		return StateAlreadyReserved, nil
	}
	if total > 0 {
		return StateAlreadyReleased, nil
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return StateReserved, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	expires := time.Now().Add(ttl)
	for _, it := range norm {
		invID, whID, err := reserveOne(ctx, tx, it.SKU, it.Quantity)
		if err != nil {
			return StateReserved, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO stock_reservations (order_id, sku, inventory_id, warehouse_id, quantity, expires_at, status)
			VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
			orderID, it.SKU, invID, whID, it.Quantity, expires,
		); err != nil {
			return StateReserved, err
		}
	}
	return StateReserved, tx.Commit(ctx)
}

type reservationLine struct {
	inventoryID *string
	sku         string
	qty         int
}

func collect(rows pgx.Rows) ([]reservationLine, error) {
	defer rows.Close()
	var out []reservationLine
	for rows.Next() {
		var l reservationLine
		if err := rows.Scan(&l.inventoryID, &l.sku, &l.qty); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ConfirmByOrder turns active reservations into a real stock decrement after
// payment. Idempotent: only 'active' rows transition.
func (r *StockRepository) ConfirmByOrder(ctx context.Context, orderID string) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		UPDATE stock_reservations SET status = 'confirmed'
		 WHERE order_id = $1 AND status = 'active'
		RETURNING inventory_id::text, sku, quantity`, orderID)
	if err != nil {
		return 0, err
	}
	lines, err := collect(rows)
	if err != nil {
		return 0, err
	}

	for _, l := range lines {
		if l.inventoryID != nil {
			_, err = tx.Exec(ctx, `
				UPDATE inventory SET quantity = quantity - $2, reserved = GREATEST(reserved - $2, 0)
				 WHERE id = $1`, *l.inventoryID, l.qty)
		} else { // legacy reservation rows without inventory_id
			_, err = tx.Exec(ctx, `
				UPDATE inventory SET quantity = quantity - $2, reserved = GREATEST(reserved - $2, 0)
				 WHERE id = (SELECT id FROM inventory WHERE sku = $1 AND reserved >= $2 LIMIT 1)`, l.sku, l.qty)
		}
		if err != nil {
			return 0, err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO stock_movements (sku, delta, reason, reference_id) VALUES ($1, $2, 'order', $3)`,
			l.sku, -l.qty, orderID,
		); err != nil {
			return 0, err
		}
	}
	return len(lines), tx.Commit(ctx)
}

// ReleaseByOrder returns reserved stock (order cancelled / payment failed). Idempotent.
func (r *StockRepository) ReleaseByOrder(ctx context.Context, orderID string) (int, error) {
	return r.release(ctx, `
		UPDATE stock_reservations SET status = 'released'
		 WHERE order_id = $1 AND status = 'active'
		RETURNING inventory_id::text, sku, quantity`, orderID)
}

// ReleaseReservation releases a single (cart) reservation by id.
func (r *StockRepository) ReleaseReservation(ctx context.Context, reservationID string) error {
	n, err := r.release(ctx, `
		UPDATE stock_reservations SET status = 'released'
		 WHERE id = $1 AND status = 'active'
		RETURNING inventory_id::text, sku, quantity`, reservationID)
	if err == nil && n == 0 {
		return pgx.ErrNoRows
	}
	return err
}

func (r *StockRepository) release(ctx context.Context, query string, arg string) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, query, arg)
	if err != nil {
		return 0, err
	}
	lines, err := collect(rows)
	if err != nil {
		return 0, err
	}
	for _, l := range lines {
		if l.inventoryID != nil {
			_, err = tx.Exec(ctx, `UPDATE inventory SET reserved = GREATEST(reserved - $2, 0) WHERE id = $1`, *l.inventoryID, l.qty)
		} else {
			_, err = tx.Exec(ctx, `
				UPDATE inventory SET reserved = GREATEST(reserved - $2, 0)
				 WHERE id = (SELECT id FROM inventory WHERE sku = $1 AND reserved >= $2 LIMIT 1)`, l.sku, l.qty)
		}
		if err != nil {
			return 0, err
		}
	}
	return len(lines), tx.Commit(ctx)
}

// ExpireReservations releases abandoned reservations in one atomic statement.
// FOR UPDATE SKIP LOCKED makes it safe to run on every replica concurrently.
func (r *StockRepository) ExpireReservations(ctx context.Context, batch int) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		WITH expired AS (
		  UPDATE stock_reservations SET status = 'expired'
		   WHERE id IN (SELECT id FROM stock_reservations
		                 WHERE status = 'active' AND expires_at < NOW()
		                 ORDER BY expires_at
		                 LIMIT $1
		                 FOR UPDATE SKIP LOCKED)
		  RETURNING inventory_id, quantity
		), agg AS (
		  SELECT inventory_id, SUM(quantity)::int AS q
		    FROM expired WHERE inventory_id IS NOT NULL GROUP BY inventory_id
		)
		UPDATE inventory i SET reserved = GREATEST(i.reserved - agg.q, 0)
		  FROM agg WHERE i.id = agg.inventory_id`, batch)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ReserveStock reserves stock for a cart (HTTP API, internal callers only).
func (r *StockRepository) ReserveStock(ctx context.Context, cartID, sku string, quantity int, expiresAt time.Time) (string, error) {
	if sku == "" || quantity <= 0 || quantity > 10000 {
		return "", ErrInvalidItems
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	invID, whID, err := reserveOne(ctx, tx, sku, quantity)
	if err != nil {
		return "", err
	}
	var resID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO stock_reservations (cart_id, sku, inventory_id, warehouse_id, quantity, expires_at, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id::text`,
		cartID, sku, invID, whID, quantity, expiresAt,
	).Scan(&resID); err != nil {
		return "", err
	}
	return resID, tx.Commit(ctx)
}

// ConfirmReservation converts a single cart reservation into a sale.
func (r *StockRepository) ConfirmReservation(ctx context.Context, reservationID, orderID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var invID *string
	var sku string
	var qty int
	err = tx.QueryRow(ctx, `
		UPDATE stock_reservations SET status = 'confirmed', order_id = $2
		 WHERE id = $1 AND status = 'active'
		RETURNING inventory_id::text, sku, quantity`, reservationID, orderID,
	).Scan(&invID, &sku, &qty)
	if err != nil {
		return err
	}
	if invID != nil {
		_, err = tx.Exec(ctx, `UPDATE inventory SET quantity = quantity - $2, reserved = GREATEST(reserved - $2, 0) WHERE id = $1`, *invID, qty)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE inventory SET quantity = quantity - $2, reserved = GREATEST(reserved - $2, 0)
			 WHERE id = (SELECT id FROM inventory WHERE sku = $1 AND reserved >= $2 LIMIT 1)`, sku, qty)
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO stock_movements (sku, delta, reason, reference_id) VALUES ($1, $2, 'order', $3)`,
		sku, -qty, orderID,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DefaultWarehouseID is the seeded platform warehouse (see infrastructure/db/init.sql).
const DefaultWarehouseID = "00000000-0000-0000-0000-000000000001"

// AdjustStock changes on-hand quantity (restock, damage, audit). Creates the
// SKU in the default warehouse on first restock.
func (r *StockRepository) AdjustStock(ctx context.Context, sku string, delta int, reason string) error {
	if sku == "" || delta == 0 {
		return ErrInvalidItems
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE inventory SET quantity = quantity + $2
		 WHERE id = (SELECT id FROM inventory WHERE sku = $1 ORDER BY id LIMIT 1)`, sku, delta)
	if err != nil {
		return err // includes CHECK violations (would go negative / below reserved)
	}
	if tag.RowsAffected() == 0 {
		if delta < 0 {
			return pgx.ErrNoRows
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO inventory (sku, warehouse_id, quantity, reserved) VALUES ($1, $2, $3, 0)`,
			sku, DefaultWarehouseID, delta,
		); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO stock_movements (sku, delta, reason) VALUES ($1, $2, $3)`, sku, delta, reason,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
