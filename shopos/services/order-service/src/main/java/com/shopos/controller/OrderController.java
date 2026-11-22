package com.shopos.controller;

import com.shopos.dto.CreateOrderRequest;
import com.shopos.dto.OrderView;
import com.shopos.service.OrderService;
import com.shopos.web.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    private static final List<String> ADMIN_ROLES = List.of("admin", "super_admin", "support");

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    /**
     * Place an order. Send an {@code Idempotency-Key} header (a UUID generated
     * once per checkout attempt) so retries never create duplicate orders.
     * Returns 201 for a new order, 200 when replaying an existing one.
     */
    @PostMapping
    public ResponseEntity<ApiResponse<OrderView>> create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateOrderRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        OrderService.PlaceResult result = orderService.placeOrder(
            jwt.getSubject(), jwt.getClaimAsString("email"), request, idempotencyKey);
        return ResponseEntity.status(result.created() ? 201 : 200).body(ApiResponse.ok(result.order()));
    }

    /** The caller's own orders, newest first. */
    @GetMapping
    public ApiResponse<List<OrderView>> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit) {
        OrderService.Page page = orderService.listOrders(jwt.getSubject(), cursor, limit);
        Map<String, Object> meta = new HashMap<>();
        meta.put("next_cursor", page.nextCursor());
        meta.put("has_more", page.nextCursor() != null);
        return ApiResponse.ok(page.items(), meta);
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<OrderView>> get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return orderService.getOrder(id)
            // 404 (not 403) for other users' orders: don't reveal that the id exists
            .filter(o -> o.userId().equals(jwt.getSubject()) || isStaff(jwt))
            .map(o -> ResponseEntity.ok(ApiResponse.ok(o)))
            .orElseGet(() -> ResponseEntity.status(404).body(ApiResponse.<OrderView>error("Order not found")));
    }

    private static boolean isStaff(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles != null && roles.stream().anyMatch(ADMIN_ROLES::contains);
    }
}
