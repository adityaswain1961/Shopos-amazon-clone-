'use client';

import { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useCartStore } from '@/store/useCartStore';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';
import type { CartItem } from '@/lib/types';

/** The only interactive part of the (server-rendered) product page. */
export function AddToCart({ item, disabled }: { item: Omit<CartItem, 'quantity'>; disabled?: boolean }) {
  const addItem = useCartStore((s) => s.addItem);
  const setCartOpen = useUiStore((s) => s.setCartOpen);
  const [qty, setQty] = useState(1);

  return (
    <div className="mt-8 flex items-center gap-4">
      <div className="flex items-center border border-border rounded-md">
        <Button variant="ghost" size="sm" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
          −
        </Button>
        <span className="w-10 text-center">{qty}</span>
        <Button variant="ghost" size="sm" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="Increase quantity">
          +
        </Button>
      </div>
      <Button
        size="lg"
        className="flex-1 gap-2"
        disabled={disabled}
        onClick={() => {
          addItem({ ...item, quantity: qty });
          setCartOpen(true);
        }}
      >
        <ShoppingCart className="h-5 w-5" />
        {disabled ? 'Unavailable' : 'Add to cart'}
      </Button>
    </div>
  );
}
