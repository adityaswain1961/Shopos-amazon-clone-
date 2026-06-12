package com.shopos.repository;

import com.shopos.model.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface OrderRepository extends JpaRepository<Order, UUID> {
    Optional<Order> findByIdempotencyKey(UUID idempotencyKey);
}
