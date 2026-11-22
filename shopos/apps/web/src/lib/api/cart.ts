import { apiFetch } from './client';
import { getGuestCartId } from '../utils';

export interface RemoteCartItem {
  product_id: string;
  variant_id: string;
  quantity: number;
  /** display hint only — the order service prices orders from the catalog */
  unit_price?: number;
}

export interface RemoteCart {
  cart_id: string;
  items: RemoteCartItem[];
}

export function fetchCart(cartId?: string): Promise<RemoteCart> {
  return apiFetch<RemoteCart>(`/api/v1/cart/${cartId ?? getGuestCartId()}`);
}

/** Set one line's quantity (idempotent upsert). */
export async function upsertRemoteCartItem(item: RemoteCartItem, cartId?: string): Promise<void> {
  await apiFetch(`/api/v1/cart/${cartId ?? getGuestCartId()}/items`, {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export async function removeRemoteCartItem(productId: string, variantId: string, cartId?: string): Promise<void> {
  const itemKey = encodeURIComponent(`${productId}:${variantId}`);
  await apiFetch(`/api/v1/cart/${cartId ?? getGuestCartId()}/items/${itemKey}`, { method: 'DELETE' });
}

export async function clearRemoteCart(cartId?: string): Promise<void> {
  await apiFetch(`/api/v1/cart/${cartId ?? getGuestCartId()}`, { method: 'DELETE' });
}
