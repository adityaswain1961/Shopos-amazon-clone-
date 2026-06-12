package com.shopos.service;

import com.shopos.dto.CreateOrderRequest;
import com.shopos.model.Order;
import com.shopos.repository.OrderRepository;
import com.shopos.saga.OrderSaga;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import java.util.UUID;

@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final OrderSaga orderSaga;

    public OrderService(OrderRepository orderRepository, OrderSaga orderSaga) {
        this.orderRepository = orderRepository;
        this.orderSaga = orderSaga;
    }

    public Order placeOrder(CreateOrderRequest request) {
        if (request.getIdempotencyKey() != null) {
            Optional<Order> existing = orderRepository.findByIdempotencyKey(request.getIdempotencyKey());
            if (existing.isPresent()) {
                return existing.get();
            }
        }

        Order order = new Order();
        order.setUserId(request.getUserId());
        order.setCartId(request.getCartId());
        order.setTotalAmount(request.getTotalAmount());
        order.setIdempotencyKey(request.getIdempotencyKey() != null ? request.getIdempotencyKey() : UUID.randomUUID());
        order.setOrderNumber(generateOrderNumber());
        order.setStatus("pending");
        order.setSagaStatus("inventory_pending");
        order.setCreatedAt(Instant.now());
        order.setUpdatedAt(Instant.now());

        Order saved = orderRepository.save(order);

        String sku = request.getSku() != null ? request.getSku() : "SKU-DEMO-001";
        int qty = request.getQuantity() != null ? request.getQuantity() : 1;
        orderSaga.startSaga(saved.getId().toString(), saved.getCartId() != null ? saved.getCartId().toString() : "", sku, qty);

        return saved;
    }

    public Optional<Order> getOrder(UUID id) {
        return orderRepository.findById(id);
    }

    private String generateOrderNumber() {
        String date = DateTimeFormatter.ofPattern("yyyyMMdd").format(Instant.now().atZone(java.time.ZoneOffset.UTC));
        int suffix = (int) (Math.random() * 9000) + 1000;
        return "ORD-" + date + "-" + suffix;
    }
}
