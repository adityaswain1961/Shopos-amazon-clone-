import { apiFetch } from './client';
import type { Order } from '../types';

export interface CreateOrderInput {
  userId: string;
  cartId?: string;
  totalAmount: number;
  idempotencyKey?: string;
  sku?: string;
  quantity?: number;
}

export async function createOrder(input: CreateOrderInput) {
  return apiFetch<Order>('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      userId: input.userId,
      cartId: input.cartId,
      totalAmount: input.totalAmount,
      idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      sku: input.sku ?? 'SKU-DEMO-001',
      quantity: input.quantity ?? 1,
    }),
  });
}

export async function fetchOrder(id: string) {
  return apiFetch<Order>(`/api/v1/orders/${id}`);
}
