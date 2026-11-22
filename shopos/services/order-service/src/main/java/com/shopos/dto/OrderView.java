package com.shopos.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrderView(
    UUID id,
    String userId,
    String orderNumber,
    String status,
    String sagaStatus,
    BigDecimal subtotalAmount,
    BigDecimal discountAmount,
    BigDecimal totalAmount,
    String currency,
    String couponCode,
    JsonNode shippingAddress,
    String failureReason,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    List<Item> items
) {

    public record Item(
        UUID productId,
        UUID variantId,
        String productTitle,
        String sku,
        int quantity,
        BigDecimal unitPrice,
        BigDecimal totalPrice
    ) {}

    public OrderView withItems(List<Item> newItems) {
        return new OrderView(id, userId, orderNumber, status, sagaStatus, subtotalAmount, discountAmount,
            totalAmount, currency, couponCode, shippingAddress, failureReason, createdAt, updatedAt, newItems);
    }
}
