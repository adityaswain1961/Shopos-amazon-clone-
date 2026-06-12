import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '@/lib/types';
import { addToRemoteCart } from '@/lib/api/cart';
import { getGuestCartId } from '@/lib/utils';

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (productId: string, variantId: string) => void;
  updateQuantity: (productId: string, variantId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
  syncToServer: () => Promise<void>;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (newItem) => {
        set((state) => {
          const existing = state.items.find(
            (i) => i.productId === newItem.productId && i.variantId === newItem.variantId,
          );
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.productId === newItem.productId && i.variantId === newItem.variantId
                  ? { ...i, quantity: i.quantity + newItem.quantity }
                  : i,
              ),
            };
          }
          return { items: [...state.items, newItem] };
        });
        get().syncToServer().catch(() => {});
      },
      removeItem: (productId, variantId) =>
        set((state) => ({
          items: state.items.filter(
            (i) => !(i.productId === productId && i.variantId === variantId),
          ),
        })),
      updateQuantity: (productId, variantId, quantity) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.productId === productId && i.variantId === variantId
              ? { ...i, quantity: Math.max(1, quantity) }
              : i,
          ),
        })),
      clearCart: () => set({ items: [] }),
      totalItems: () => get().items.reduce((acc, item) => acc + item.quantity, 0),
      totalPrice: () =>
        get().items.reduce((acc, item) => acc + item.price * item.quantity, 0),
      syncToServer: async () => {
        const cartId = getGuestCartId();
        const items = get().items;
        for (const item of items) {
          await addToRemoteCart({
            product_id: item.productId,
            variant_id: item.variantId || 'default',
            quantity: item.quantity,
            unit_price: item.price,
          }, cartId);
        }
      },
    }),
    { name: 'shopos-cart' },
  ),
);

export type { CartItem };
