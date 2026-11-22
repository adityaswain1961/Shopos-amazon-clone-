package com.shopos.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * Checkout request. Note what is NOT here: user id (taken from the JWT) and
 * prices/totals (computed server-side from the catalog). Clients cannot set them.
 */
public record CreateOrderRequest(
    @NotEmpty @Size(max = 50) List<@Valid @NotNull Item> items,
    @Valid @NotNull Address shippingAddress,
    @Size(max = 50) String couponCode,
    @Size(max = 100) String idempotencyKey,
    @Size(max = 100) String cartId
) {

    public record Item(
        @NotNull UUID productId,
        UUID variantId,
        @Min(1) @Max(99) int quantity
    ) {}

    public record Address(
        @NotBlank @Size(max = 200) String fullName,
        @NotBlank @Size(max = 300) String line1,
        @Size(max = 300) String line2,
        @NotBlank @Size(max = 100) String city,
        @Size(max = 100) String state,
        @NotBlank @Size(max = 20) String postalCode,
        @Size(max = 2) String country,
        @NotBlank @Size(max = 20) String phone
    ) {}
}
