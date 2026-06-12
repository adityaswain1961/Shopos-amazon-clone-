import { API_URL } from './client';
import { getGuestCartId } from '../utils';

export interface RemoteCartItem {
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
}

export interface RemoteCart {
  cart_id: string;
  items: RemoteCartItem[];
}

export async function fetchCart(cartId?: string): Promise<RemoteCart> {
  const id = cartId ?? getGuestCartId();
  const res = await fetch(`${API_URL}/api/v1/cart/${id}`, {
    headers: { 'X-Correlation-Id': crypto.randomUUID() },
  });
  if (!res.ok) throw new Error('Failed to load cart');
  return res.json();
}

export async function addToRemoteCart(
  item: RemoteCartItem,
  cartId?: string,
): Promise<void> {
  const id = cartId ?? getGuestCartId();
  const res = await fetch(`${API_URL}/api/v1/cart/${id}/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': crypto.randomUUID(),
    },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error('Failed to add to cart');
}

export async function removeFromRemoteCart(
  itemKey: string,
  cartId?: string,
): Promise<void> {
  const id = cartId ?? getGuestCartId();
  await fetch(`${API_URL}/api/v1/cart/${id}/items/${itemKey}`, {
    method: 'DELETE',
    headers: { 'X-Correlation-Id': crypto.randomUUID() },
  });
}
