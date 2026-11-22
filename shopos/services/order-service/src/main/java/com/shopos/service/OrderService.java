package com.shopos.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shopos.dto.CreateOrderRequest;
import com.shopos.dto.OrderView;
import com.shopos.outbox.OutboxWriter;
import com.shopos.web.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class OrderService {

    private static final SecureRandom RNG = new SecureRandom();
    private static final char[] CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();
    private static final DateTimeFormatter ORDER_DATE = DateTimeFormatter.ofPattern("yyMMdd");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ObjectMapper mapper;
    private final OutboxWriter outbox;
    private final int maxItems;

    public OrderService(JdbcTemplate jdbc,
                        PlatformTransactionManager tm,
                        ObjectMapper mapper,
                        OutboxWriter outbox,
                        @Value("${shopos.orders.max-items:50}") int maxItems) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(tm);
        this.mapper = mapper;
        this.outbox = outbox;
        this.maxItems = maxItems;
    }

    public record PlaceResult(OrderView order, boolean created) {}

    private record ProductRow(UUID id, String title, BigDecimal basePrice, String currency, String status, String sellerId) {}

    private record VariantRow(UUID id, UUID productId, String sku, BigDecimal price) {}

    private record Line(UUID productId, UUID variantId, String sku, String title, String sellerId,
                        int quantity, BigDecimal unitPrice) {
        BigDecimal total() {
            return unitPrice.multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.HALF_UP);
        }
    }

    private record Priced(List<Line> lines, String currency, BigDecimal subtotal) {}

    // ─── Place order ─────────────────────────────────────────────────

    public PlaceResult placeOrder(String userId, String email, CreateOrderRequest req, String headerKey) {
        String idemKey = headerKey != null && !headerKey.isBlank() ? headerKey.trim() : req.idempotencyKey();
        if (idemKey != null && idemKey.length() > 100) {
            throw new ApiException(400, "Idempotency-Key must be at most 100 characters");
        }

        // Replays of the same checkout (double click, client retry after a
        // timeout) return the original order instead of charging twice.
        if (idemKey != null) {
            Optional<UUID> existing = findByIdempotencyKey(userId, idemKey);
            if (existing.isPresent()) {
                return new PlaceResult(getOrder(existing.get()).orElseThrow(), false);
            }
        }

        Priced priced = price(req.items());

        try {
            UUID orderId = tx.execute(status -> insertOrder(userId, email, req, idemKey, priced));
            return new PlaceResult(getOrder(orderId).orElseThrow(), true);
        } catch (DuplicateKeyException e) {
            if (idemKey != null) {
                Optional<UUID> existing = findByIdempotencyKey(userId, idemKey);
                if (existing.isPresent()) {
                    return new PlaceResult(getOrder(existing.get()).orElseThrow(), false);
                }
            }
            throw e;
        }
    }

    private Optional<UUID> findByIdempotencyKey(String userId, String key) {
        List<UUID> ids = jdbc.query(
            "SELECT id FROM orders WHERE user_id = ? AND idempotency_key = ?",
            (rs, i) -> rs.getObject("id", UUID.class), userId, key);
        return ids.stream().findFirst();
    }

    /** Server-side pricing from the catalog. Client-sent prices are never trusted. */
    private Priced price(List<CreateOrderRequest.Item> items) {
        if (items.size() > maxItems) {
            throw new ApiException(400, "An order can contain at most " + maxItems + " lines");
        }

        // Merge duplicate lines (same product + variant)
        Map<String, CreateOrderRequest.Item> merged = new LinkedHashMap<>();
        for (CreateOrderRequest.Item it : items) {
            String key = it.productId() + ":" + it.variantId();
            CreateOrderRequest.Item prev = merged.get(key);
            int qty = Math.min(99, it.quantity() + (prev == null ? 0 : prev.quantity()));
            merged.put(key, new CreateOrderRequest.Item(it.productId(), it.variantId(), qty));
        }

        Set<UUID> productIds = new LinkedHashSet<>();
        merged.values().forEach(i -> productIds.add(i.productId()));
        String placeholders = String.join(",", Collections.nCopies(productIds.size(), "?"));
        Object[] args = productIds.toArray();

        Map<UUID, ProductRow> products = new HashMap<>();
        jdbc.query(
            "SELECT id, title, base_price, currency, status, seller_id FROM products WHERE id IN (" + placeholders + ")",
            (RowCallbackHandler) rs -> {
                UUID id = rs.getObject("id", UUID.class);
                products.put(id, new ProductRow(id, rs.getString("title"), rs.getBigDecimal("base_price"),
                    rs.getString("currency"), rs.getString("status"), rs.getString("seller_id")));
            },
            args);

        Map<UUID, List<VariantRow>> variants = new HashMap<>();
        jdbc.query(
            "SELECT id, product_id, sku, price FROM product_variants WHERE product_id IN (" + placeholders + ") "
                + "ORDER BY created_at, id",
            (RowCallbackHandler) rs -> {
                UUID pid = rs.getObject("product_id", UUID.class);
                variants.computeIfAbsent(pid, k -> new ArrayList<>()).add(new VariantRow(
                    rs.getObject("id", UUID.class), pid, rs.getString("sku"), rs.getBigDecimal("price")));
            },
            args);

        List<Line> lines = new ArrayList<>();
        String currency = null;
        BigDecimal subtotal = BigDecimal.ZERO;

        for (CreateOrderRequest.Item it : merged.values()) {
            ProductRow p = products.get(it.productId());
            if (p == null || !"published".equals(p.status())) {
                throw new ApiException(400, "Product " + it.productId() + " is not available");
            }
            List<VariantRow> vs = variants.getOrDefault(p.id(), List.of());
            VariantRow v;
            if (it.variantId() != null) {
                v = vs.stream().filter(x -> x.id().equals(it.variantId())).findFirst()
                    .orElseThrow(() -> new ApiException(400, "Variant " + it.variantId() + " not found for product " + p.id()));
            } else {
                v = vs.isEmpty() ? null : vs.get(0);
            }

            String lineCurrency = p.currency() == null ? "INR" : p.currency().trim();
            if (currency == null) {
                currency = lineCurrency;
            } else if (!currency.equals(lineCurrency)) {
                throw new ApiException(400, "All items in one order must use the same currency");
            }

            BigDecimal unit = (v != null && v.price() != null) ? v.price() : p.basePrice();
            String sku = v != null ? v.sku() : "PRODUCT-" + p.id();
            Line line = new Line(p.id(), v == null ? null : v.id(), sku, p.title(), p.sellerId(), it.quantity(), unit);
            lines.add(line);
            subtotal = subtotal.add(line.total());
        }

        return new Priced(lines, currency, subtotal.setScale(2, RoundingMode.HALF_UP));
    }

    private UUID insertOrder(String userId, String email, CreateOrderRequest req, String idemKey, Priced priced) {
        UUID orderId = UUID.randomUUID();
        String orderNumber = newOrderNumber();

        BigDecimal discount = BigDecimal.ZERO;
        String couponCode = null;
        if (req.couponCode() != null && !req.couponCode().isBlank()) {
            couponCode = req.couponCode().trim().toUpperCase(Locale.ROOT);
            discount = redeemCoupon(couponCode, userId, orderId, priced.subtotal());
        }
        BigDecimal total = priced.subtotal().subtract(discount).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);

        String address = toJson(req.shippingAddress());

        jdbc.update("""
            INSERT INTO orders (id, user_id, user_email, cart_id, order_number, status, subtotal_amount,
                                total_amount, discount_amount, currency, coupon_code, shipping_address,
                                billing_address, idempotency_key, saga_status)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, 'inventory_pending')
            """,
            orderId, userId, email, req.cartId(), orderNumber, priced.subtotal(), total, discount,
            priced.currency(), couponCode, address, address, idemKey);

        List<Object[]> itemRows = new ArrayList<>();
        for (Line l : priced.lines()) {
            itemRows.add(new Object[]{orderId, l.productId(), l.variantId(), l.sellerId(),
                truncate(l.title(), 300), l.sku(), l.quantity(), l.unitPrice(), l.total()});
        }
        jdbc.batchUpdate("""
            INSERT INTO order_items (order_id, product_id, variant_id, seller_id, product_title, sku,
                                     quantity, unit_price, total_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, itemRows);

        jdbc.update("INSERT INTO order_timeline (order_id, event, description) VALUES (?, 'order_placed', ?)",
            orderId, "Order " + orderNumber + " placed");

        List<Map<String, Object>> eventItems = new ArrayList<>();
        for (Line l : priced.lines()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("productId", l.productId().toString());
            m.put("sku", l.sku());
            m.put("quantity", l.quantity());
            eventItems.add(m);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("orderId", orderId.toString());
        payload.put("orderNumber", orderNumber);
        payload.put("userId", userId);
        payload.put("items", eventItems);
        payload.put("totalAmount", total);
        payload.put("currency", priced.currency());
        outbox.write(orderId.toString(), "order.created", payload);

        return orderId;
    }

    /**
     * Atomically consumes one use of the coupon inside the order transaction.
     * If anything later fails, the transaction rollback restores the count.
     */
    private BigDecimal redeemCoupon(String code, String userId, UUID orderId, BigDecimal subtotal) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            UPDATE coupons SET used_count = used_count + 1
             WHERE code = ? AND is_active = TRUE
               AND (starts_at IS NULL OR starts_at <= NOW())
               AND (expires_at IS NULL OR expires_at > NOW())
               AND (usage_limit IS NULL OR used_count < usage_limit)
               AND COALESCE(min_order_value, 0) <= ?
            RETURNING id, type, value, max_discount, per_user_limit
            """, code, subtotal);
        if (rows.isEmpty()) {
            throw new ApiException(400, "Coupon is invalid, expired, or not applicable to this order");
        }
        Map<String, Object> c = rows.get(0);
        UUID couponId = (UUID) c.get("id");
        int perUser = c.get("per_user_limit") == null ? 1 : ((Number) c.get("per_user_limit")).intValue();

        // Serialise concurrent checkouts of the same user+coupon (transaction-scoped lock).
        jdbc.query("SELECT pg_advisory_xact_lock(hashtext(?))", (ResultSetExtractor<Void>) rs -> null,
            couponId + ":" + userId);
        Integer used = jdbc.queryForObject(
            "SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?",
            Integer.class, couponId, userId);
        if (used != null && used >= perUser) {
            throw new ApiException(400, "You have already used this coupon");
        }
        jdbc.update("INSERT INTO coupon_redemptions (coupon_id, user_id, order_id) VALUES (?, ?, ?)",
            couponId, userId, orderId);

        BigDecimal value = (BigDecimal) c.get("value");
        BigDecimal discount = "percentage".equals(c.get("type"))
            ? subtotal.multiply(value).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP)
            : value;
        if (c.get("max_discount") != null) {
            discount = discount.min((BigDecimal) c.get("max_discount"));
        }
        return discount.min(subtotal).setScale(2, RoundingMode.HALF_UP);
    }

    /**
     * SO-YYMMDD-XXXXXXXXXX: 10 Crockford base32 chars = 50 random bits per day.
     * (The old 4-digit suffix had 9,000 values per day and collided almost immediately.)
     */
    private static String newOrderNumber() {
        StringBuilder sb = new StringBuilder("SO-")
            .append(ORDER_DATE.format(OffsetDateTime.now(ZoneOffset.UTC)))
            .append('-');
        for (int i = 0; i < 10; i++) {
            sb.append(CROCKFORD[RNG.nextInt(CROCKFORD.length)]);
        }
        return sb.toString();
    }

    // ─── Reads ───────────────────────────────────────────────────────

    private final RowMapper<OrderView> orderMapper = (rs, i) -> new OrderView(
        rs.getObject("id", UUID.class),
        rs.getString("user_id"),
        rs.getString("order_number"),
        rs.getString("status"),
        rs.getString("saga_status"),
        rs.getBigDecimal("subtotal_amount"),
        rs.getBigDecimal("discount_amount"),
        rs.getBigDecimal("total_amount"),
        rs.getString("currency") == null ? null : rs.getString("currency").trim(),
        rs.getString("coupon_code"),
        readJson(rs.getString("shipping_address")),
        rs.getString("failure_reason"),
        rs.getObject("created_at", OffsetDateTime.class),
        rs.getObject("updated_at", OffsetDateTime.class),
        null);

    private static final String ORDER_COLUMNS = """
        id, user_id, order_number, status, saga_status, subtotal_amount, discount_amount, total_amount,
        currency, coupon_code, shipping_address::text AS shipping_address, failure_reason, created_at, updated_at
        """;

    public Optional<OrderView> getOrder(UUID id) {
        List<OrderView> rows = jdbc.query("SELECT " + ORDER_COLUMNS + " FROM orders WHERE id = ?", orderMapper, id);
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        List<OrderView.Item> items = jdbc.query("""
            SELECT product_id, variant_id, product_title, sku, quantity, unit_price, total_price
              FROM order_items WHERE order_id = ? ORDER BY product_title
            """,
            (rs, i) -> new OrderView.Item(
                rs.getObject("product_id", UUID.class),
                rs.getObject("variant_id", UUID.class),
                rs.getString("product_title"),
                rs.getString("sku"),
                rs.getInt("quantity"),
                rs.getBigDecimal("unit_price"),
                rs.getBigDecimal("total_price")),
            id);
        return Optional.of(rows.get(0).withItems(items));
    }

    public record Page(List<OrderView> items, String nextCursor) {}

    /** Keyset pagination: constant cost no matter how many orders a user has. */
    public Page listOrders(String userId, String cursor, int limit) {
        int size = Math.max(1, Math.min(limit, 50));
        OffsetDateTime afterAt = null;
        UUID afterId = null;
        if (cursor != null && !cursor.isBlank()) {
            try {
                String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\|");
                afterAt = OffsetDateTime.parse(parts[0]);
                afterId = UUID.fromString(parts[1]);
            } catch (RuntimeException e) {
                throw new ApiException(400, "Invalid cursor");
            }
        }

        List<OrderView> rows = afterAt == null
            ? jdbc.query("SELECT " + ORDER_COLUMNS + " FROM orders WHERE user_id = ? "
                + "ORDER BY created_at DESC, id DESC LIMIT ?", orderMapper, userId, size + 1)
            : jdbc.query("SELECT " + ORDER_COLUMNS + " FROM orders WHERE user_id = ? "
                + "AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?",
                orderMapper, userId, afterAt, afterId, size + 1);

        String next = null;
        if (rows.size() > size) {
            rows = rows.subList(0, size);
            OrderView last = rows.get(rows.size() - 1);
            next = Base64.getUrlEncoder().withoutPadding().encodeToString(
                (last.createdAt().toString() + "|" + last.id()).getBytes(StandardCharsets.UTF_8));
        }
        return new Page(rows, next);
    }

    // ─── helpers ─────────────────────────────────────────────────────

    private String toJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private JsonNode readJson(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return mapper.readTree(raw);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
