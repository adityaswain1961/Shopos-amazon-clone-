package com.shopos.saga;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shopos.outbox.OutboxWriter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Checkout saga (orchestrated by the order service).
 *
 *   inventory_pending --inventory.confirmed--> payment_pending --payment.completed--> completed (order confirmed)
 *          |                                         |
 *          +--inventory.failed--> failed             +--payment.failed / timeout--> failed (+ inventory.release)
 *
 * Every transition is a conditional UPDATE ("... WHERE saga_status = <expected>").
 * A duplicate, late or out-of-order event therefore matches zero rows and is
 * ignored, which makes all handlers idempotent under Kafka's at-least-once
 * delivery. State change + follow-up events are committed atomically via the outbox.
 */
@Component
public class OrderSaga {

    private static final Logger log = LoggerFactory.getLogger(OrderSaga.class);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ObjectMapper mapper;
    private final OutboxWriter outbox;
    private final int paymentTimeoutMinutes;

    public OrderSaga(JdbcTemplate jdbc,
                     PlatformTransactionManager tm,
                     ObjectMapper mapper,
                     OutboxWriter outbox,
                     @Value("${shopos.saga.payment-timeout-minutes:20}") int paymentTimeoutMinutes) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(tm);
        this.mapper = mapper;
        this.outbox = outbox;
        this.paymentTimeoutMinutes = paymentTimeoutMinutes;
    }

    // ─── Listeners ───────────────────────────────────────────────────

    @KafkaListener(topics = "inventory.confirmed", groupId = "order-saga-group")
    public void onInventoryConfirmed(String message) {
        UUID orderId = orderIdOf(message);
        if (orderId == null) return;

        tx.executeWithoutResult(s -> {
            List<Map<String, Object>> rows = jdbc.queryForList("""
                UPDATE orders SET saga_status = 'payment_pending', updated_at = NOW()
                 WHERE id = ? AND saga_status = 'inventory_pending'
                RETURNING id, user_id, user_email, order_number, total_amount, currency
                """, orderId);
            if (rows.isEmpty()) return;
            Map<String, Object> o = rows.get(0);
            timeline(orderId, "inventory_reserved", "Stock reserved");

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("orderId", orderId.toString());
            payload.put("orderNumber", o.get("order_number"));
            payload.put("userId", o.get("user_id"));
            payload.put("email", o.get("user_email"));
            payload.put("amount", o.get("total_amount"));
            payload.put("currency", trim(o.get("currency")));
            outbox.write(orderId.toString(), "payment.initiate", payload);
        });
    }

    @KafkaListener(topics = "inventory.failed", groupId = "order-saga-group")
    public void onInventoryFailed(String message) {
        UUID orderId = orderIdOf(message);
        if (orderId == null) return;
        String reason = textOf(message, "reason", "out_of_stock");

        tx.executeWithoutResult(s -> {
            List<Map<String, Object>> rows = jdbc.queryForList("""
                UPDATE orders SET status = 'cancelled', saga_status = 'failed', failure_reason = ?, updated_at = NOW()
                 WHERE id = ? AND saga_status = 'inventory_pending'
                RETURNING id, user_id, user_email, order_number
                """, truncate(reason, 200), orderId);
            if (rows.isEmpty()) return;
            restoreCoupon(orderId);
            timeline(orderId, "cancelled", "Items unavailable: " + reason);
            outbox.write(orderId.toString(), "order.cancelled", cancelledPayload(rows.get(0), reason));
        });
    }

    @KafkaListener(topics = "payment.completed", groupId = "order-saga-group")
    public void onPaymentCompleted(String message) {
        UUID orderId = orderIdOf(message);
        if (orderId == null) return;

        tx.executeWithoutResult(s -> {
            List<Map<String, Object>> rows = jdbc.queryForList("""
                UPDATE orders SET status = 'confirmed', saga_status = 'completed', updated_at = NOW()
                 WHERE id = ? AND saga_status = 'payment_pending'
                RETURNING id, user_id, user_email, order_number, total_amount, currency
                """, orderId);

            if (rows.isEmpty()) {
                // Payment succeeded for an order we already cancelled (e.g. it
                // timed out while the customer was on the payment page). Never
                // keep money for a cancelled order: ask payment-service to refund.
                Integer cancelled = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM orders WHERE id = ? AND saga_status = 'failed'", Integer.class, orderId);
                if (cancelled != null && cancelled > 0) {
                    Map<String, Object> refund = new LinkedHashMap<>();
                    refund.put("orderId", orderId.toString());
                    refund.put("reason", "order_cancelled_before_payment");
                    outbox.write(orderId.toString(), "payment.refund_requested", refund);
                    log.warn("Payment completed for cancelled order {}; refund requested", orderId);
                }
                return;
            }

            Map<String, Object> o = rows.get(0);
            timeline(orderId, "confirmed", "Payment received");

            List<Map<String, Object>> items = new ArrayList<>();
            jdbc.query("SELECT sku, quantity FROM order_items WHERE order_id = ?", (RowCallbackHandler) rs -> {
                Map<String, Object> it = new LinkedHashMap<>();
                it.put("sku", rs.getString("sku"));
                it.put("quantity", rs.getInt("quantity"));
                items.add(it);
            }, orderId);

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("orderId", orderId.toString());
            payload.put("orderNumber", o.get("order_number"));
            payload.put("userId", o.get("user_id"));
            payload.put("email", o.get("user_email"));
            payload.put("totalAmount", o.get("total_amount"));
            payload.put("currency", trim(o.get("currency")));
            payload.put("items", items);
            // inventory commits the reservation; notification emails the customer
            outbox.write(orderId.toString(), "order.confirmed", payload);
        });
    }

    @KafkaListener(topics = "payment.failed", groupId = "order-saga-group")
    public void onPaymentFailed(String message) {
        UUID orderId = orderIdOf(message);
        if (orderId == null) return;
        failPayment(orderId, textOf(message, "reason", "payment_failed"));
    }

    // ─── Timeout sweeper ─────────────────────────────────────────────

    /**
     * Customers abandon payment pages. Release their stock before inventory's
     * own reservation expiry so other shoppers can buy it. Multi-replica safe:
     * rows are claimed with SKIP LOCKED.
     */
    @Scheduled(fixedDelay = 60_000L, initialDelay = 60_000L)
    public void expireStalePayments() {
        try {
            List<UUID> stale = tx.execute(s -> jdbc.query("""
                SELECT id FROM orders
                 WHERE saga_status = 'payment_pending'
                   AND updated_at < NOW() - make_interval(mins => ?)
                 ORDER BY updated_at
                 LIMIT 200
                 FOR UPDATE SKIP LOCKED
                """, (rs, i) -> rs.getObject("id", UUID.class), paymentTimeoutMinutes));
            if (stale != null) {
                stale.forEach(id -> failPayment(id, "payment_timeout"));
            }
        } catch (Exception e) {
            log.warn("Payment timeout sweep failed: {}", e.getMessage());
        }
    }

    // ─── helpers ─────────────────────────────────────────────────────

    private void failPayment(UUID orderId, String reason) {
        tx.executeWithoutResult(s -> {
            List<Map<String, Object>> rows = jdbc.queryForList("""
                UPDATE orders SET status = 'payment_failed', saga_status = 'failed', failure_reason = ?, updated_at = NOW()
                 WHERE id = ? AND saga_status = 'payment_pending'
                RETURNING id, user_id, user_email, order_number
                """, truncate(reason, 200), orderId);
            if (rows.isEmpty()) return;
            restoreCoupon(orderId);
            timeline(orderId, "payment_failed", reason);

            Map<String, Object> release = new LinkedHashMap<>();
            release.put("orderId", orderId.toString());
            outbox.write(orderId.toString(), "inventory.release", release);
            outbox.write(orderId.toString(), "order.cancelled", cancelledPayload(rows.get(0), reason));
        });
    }

    private void restoreCoupon(UUID orderId) {
        jdbc.update("""
            WITH r AS (DELETE FROM coupon_redemptions WHERE order_id = ? RETURNING coupon_id)
            UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id IN (SELECT coupon_id FROM r)
            """, orderId);
    }

    private void timeline(UUID orderId, String event, String description) {
        jdbc.update("INSERT INTO order_timeline (order_id, event, description) VALUES (?, ?, ?)",
            orderId, event, truncate(description, 1000));
    }

    private Map<String, Object> cancelledPayload(Map<String, Object> o, String reason) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("orderId", String.valueOf(o.get("id")));
        p.put("orderNumber", o.get("order_number"));
        p.put("userId", o.get("user_id"));
        p.put("email", o.get("user_email"));
        p.put("reason", reason);
        return p;
    }

    private JsonNode payloadOf(String message) {
        try {
            JsonNode root = mapper.readTree(message);
            JsonNode payload = root.get("payload");
            return payload != null && payload.isObject() ? payload : root;
        } catch (Exception e) {
            return null;
        }
    }

    private UUID orderIdOf(String message) {
        JsonNode p = payloadOf(message);
        JsonNode id = p == null ? null : p.get("orderId");
        if (id == null || !id.isTextual()) {
            log.warn("Saga message without a valid orderId; skipping");
            return null;
        }
        try {
            return UUID.fromString(id.asText());
        } catch (IllegalArgumentException e) {
            log.warn("Saga message with malformed orderId '{}'; skipping", id.asText());
            return null;
        }
    }

    private String textOf(String message, String field, String fallback) {
        JsonNode p = payloadOf(message);
        JsonNode v = p == null ? null : p.get(field);
        return v != null && v.isTextual() && !v.asText().isBlank() ? v.asText() : fallback;
    }

    private static Object trim(Object v) {
        return v instanceof String s ? s.trim() : v;
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
