import os
import threading
import time

from psycopg2.pool import ThreadedConnectionPool

_pool: ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()
_cache: dict = {"at": 0.0, "data": None}
_cache_lock = threading.Lock()
CACHE_SECONDS = int(os.getenv("DASHBOARD_CACHE_SECONDS", "30"))

FULFILLED = ("confirmed", "shipped", "delivered")


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    1,
                    int(os.getenv("PG_POOL_MAX", "4")),
                    dsn=os.getenv("DATABASE_URL", "postgresql://shopos_admin:shopos_password@localhost:5432/shopos_db"),
                    connect_timeout=5,
                    application_name="analytics-service",
                )
    return _pool


def ping() -> bool:
    try:
        pool = _get_pool()
        conn = pool.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            conn.rollback()
            return True
        finally:
            pool.putconn(conn)
    except Exception:
        return False


def dashboard_metrics() -> dict:
    """Today's KPIs from the orders tables, cached so a busy admin UI can't load the primary."""
    with _cache_lock:
        if _cache["data"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["data"]

    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FILTER (WHERE status = ANY(%(ok)s)),
                       COALESCE(SUM(total_amount) FILTER (WHERE status = ANY(%(ok)s)), 0),
                       COUNT(*) FILTER (WHERE status IN ('cancelled', 'payment_failed')),
                       COUNT(DISTINCT user_id)
                  FROM orders
                 WHERE created_at >= date_trunc('day', NOW())
                """,
                {"ok": list(FULFILLED)},
            )
            confirmed, revenue, failed, buyers = cur.fetchone()
            cur.execute(
                """
                SELECT oi.product_title, SUM(oi.quantity) AS units
                  FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE o.created_at >= date_trunc('day', NOW()) AND o.status = ANY(%(ok)s)
                 GROUP BY oi.product_title
                 ORDER BY units DESC
                 LIMIT 5
                """,
                {"ok": list(FULFILLED)},
            )
            top = [{"title": title, "units": int(units)} for title, units in cur.fetchall()]
        conn.rollback()  # read-only; end the transaction
    finally:
        pool.putconn(conn)

    attempted = confirmed + failed
    data = {
        "date": time.strftime("%Y-%m-%d", time.gmtime()),
        "orders_confirmed_today": int(confirmed),
        "orders_failed_today": int(failed),
        "revenue_today": float(revenue),
        "unique_buyers_today": int(buyers),
        "checkout_success_rate": round(confirmed / attempted, 4) if attempted else None,
        "top_products": top,
    }
    with _cache_lock:
        _cache.update(at=time.time(), data=data)
    return data
