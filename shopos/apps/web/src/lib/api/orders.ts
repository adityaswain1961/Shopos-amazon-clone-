import { apiFetch, apiFetchWithMeta } from './client';
import type { Order, ShippingAddress } from '../types';

export interface CreateOrderInput {
  items: Array<{ productId: string; variantId?: string; quantity: number }>;
  shippingAddress: ShippingAddress;
  couponCode?: string;
  cartId?: string;
  /** One key per checkout attempt: retries/double-clicks return the same order. */
  idempotencyKey: string;
}

/**
 * Place an order. Note what is NOT sent: user id (from the JWT) and prices or
 * totals (the order service computes them from the catalog).
 */
export function createOrder(input: CreateOrderInput) {
  const { idempotencyKey, ...body } = input;
  return apiFetch<Order>('/api/v1/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      ...body,
      items: body.items.map((i) => ({
        productId: i.productId,
        // 'default' is the cart's placeholder for "no variant"
        variantId: i.variantId && i.variantId !== 'default' ? i.variantId : undefined,
        quantity: i.quantity,
      })),
    }),
  });
}

export function fetchOrder(id: string) {
  return apiFetch<Order>(`/api/v1/orders/${id}`);
}

export async function fetchMyOrders(cursor?: string) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const { data, meta } = await apiFetchWithMeta<Order[]>(`/api/v1/orders${q}`);
  return { orders: data, nextCursor: (meta?.next_cursor as string | null) ?? null };
}
