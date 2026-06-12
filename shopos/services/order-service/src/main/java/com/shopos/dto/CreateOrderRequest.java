package com.shopos.dto;

import java.math.BigDecimal;
import java.util.UUID;

public class CreateOrderRequest {
    private UUID userId;
    private UUID cartId;
    private BigDecimal totalAmount;
    private UUID idempotencyKey;
    private String sku;
    private Integer quantity;

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }
    public UUID getCartId() { return cartId; }
    public void setCartId(UUID cartId) { this.cartId = cartId; }
    public BigDecimal getTotalAmount() { return totalAmount; }
    public void setTotalAmount(BigDecimal totalAmount) { this.totalAmount = totalAmount; }
    public UUID getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(UUID idempotencyKey) { this.idempotencyKey = idempotencyKey; }
    public String getSku() { return sku; }
    public void setSku(String sku) { this.sku = sku; }
    public Integer getQuantity() { return quantity; }
    public void setQuantity(Integer quantity) { this.quantity = quantity; }
}
