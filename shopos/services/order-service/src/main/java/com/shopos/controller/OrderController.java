package com.shopos.controller;

import com.shopos.dto.CreateOrderRequest;
import com.shopos.model.Order;
import com.shopos.service.OrderService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public ResponseEntity<?> createOrder(@RequestBody CreateOrderRequest request) {
        if (request.getUserId() == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "userId is required"));
        }
        Order order = orderService.placeOrder(request);
        return ResponseEntity.status(201).body(Map.of("success", true, "data", order));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getOrder(@PathVariable UUID id) {
        return orderService.getOrder(id)
                .map(order -> ResponseEntity.ok(Map.of("success", true, "data", order)))
                .orElse(ResponseEntity.notFound().build());
    }

}
