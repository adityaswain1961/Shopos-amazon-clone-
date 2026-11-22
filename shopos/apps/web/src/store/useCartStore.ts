import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '@/lib/types';
import { upsertRemoteCartItem, removeRemoteCartItem, clearRemoteCart } from '@/lib/api/cart';

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (productId: string, variantId: string) => void;
  updateQuantity: (productId: string, variantId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
}

const MAX_QTY = 99;

// The browser cart is the UI source of truth; the server copy (cart-service)
// is synced one line at a time, fire-and-forget. Only the line that changed
// is sent — never the whole cart on every click.
function syncLine(item: CartItem) {
  upsertRemoteCartItem({
    product_id: item.productId,
    variant_id: item.variantId || 'default',
    quantity: item.quantity,
    unit_price: item.price,
  }).catch(() => {});
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (newItem) => {
        const existing = get().items.find(
          (i) => i.productId === newItem.productId && i.variantId === newItem.variantId,
        );
        const next: CartItem = existing
          ? { ...existing, quantity: Math.min(MAX_QTY, existing.quantity + newItem.quantity) }
          : { ...newItem, quantity: Math.min(MAX_QTY, newItem.quantity) };
        set((state) => ({
          items: existing
            ? state.items.map((i) => (i === existing ? next : i))
            : [...state.items, next],
        }));
        syncLine(next);
      },
      removeItem: (productId, variantId) => {
        set((state) => ({
          items: state.items.filter((i) => !(i.productId === productId && i.variantId === variantId)),
        }));
        removeRemoteCartItem(productId, variantId || 'default').catch(() => {});
      },
      updateQuantity: (productId, variantId, quantity) => {
        const q = Math.max(1, Math.min(MAX_QTY, quantity));
        let changed: CartItem | undefined;
        set((state) => ({
          items: state.items.map((i) => {
            if (i.productId === productId && i.variantId === variantId) {
              changed = { ...i, quantity: q };
              return changed;
            }
            return i;
          }),
        }));
        if (changed) syncLine(changed);
      },
      clearCart: () => {
        set({ items: [] });
        clearRemoteCart().catch(() => {});
      },
      totalItems: () => get().items.reduce((acc, item) => acc + item.quantity, 0),
      totalPrice: () => get().items.reduce((acc, item) => acc + item.price * item.quantity, 0),
    }),
    { name: 'shopos-cart' },
  ),
);

export type { CartItem };
