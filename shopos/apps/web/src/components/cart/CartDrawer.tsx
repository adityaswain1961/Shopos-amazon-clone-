'use client';

import Link from 'next/link';
import Image from 'next/image';
import { X, Minus, Plus, Trash2 } from 'lucide-react';
import { useCartStore } from '@/store/useCartStore';
import { useUiStore } from '@/store/uiStore';
import { formatPrice, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function CartDrawer() {
  const open = useUiStore((s) => s.cartOpen);
  const setCartOpen = useUiStore((s) => s.setCartOpen);
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const totalPrice = useCartStore((s) => s.totalPrice());

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={() => setCartOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 className="text-lg font-semibold">Your cart</h2>
          <Button variant="ghost" size="sm" onClick={() => setCartOpen(false)} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">Your cart is empty</p>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={`${item.productId}-${item.variantId}`} className="flex gap-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-white/5">
                    {item.imageUrl && (
                      <Image src={item.imageUrl} alt="" fill className="object-cover" unoptimized />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col">
                    <p className="font-medium text-sm line-clamp-2">{item.name}</p>
                    <p className="text-sm text-primary">{formatPrice(item.price)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() =>
                          updateQuantity(item.productId, item.variantId, item.quantity - 1)
                        }
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-sm">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() =>
                          updateQuantity(item.productId, item.variantId, item.quantity + 1)
                        }
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 w-7 p-0 text-red-400"
                        onClick={() => removeItem(item.productId, item.variantId)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border p-4 space-y-3">
            <div className="flex justify-between font-semibold">
              <span>Subtotal</span>
              <span>{formatPrice(totalPrice)}</span>
            </div>
            <Link href="/checkout" onClick={() => setCartOpen(false)}>
              <Button className="w-full" size="lg">
                Checkout
              </Button>
            </Link>
            <Link href="/cart" onClick={() => setCartOpen(false)}>
              <Button variant="outline" className="w-full">
                View cart
              </Button>
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
