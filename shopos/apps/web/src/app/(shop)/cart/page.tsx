'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCartStore } from '@/store/useCartStore';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2 } from 'lucide-react';

export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const totalPrice = useCartStore((s) => s.totalPrice());

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Shopping cart</h1>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>Your cart is empty.</p>
            <Link href="/products">
              <Button className="mt-4">Continue shopping</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-8 lg:grid-cols-3">
          <ul className="lg:col-span-2 space-y-4">
            {items.map((item) => (
              <li
                key={`${item.productId}-${item.variantId}`}
                className="flex gap-4 rounded-xl border border-border/50 bg-card p-4"
              >
                <div className="relative h-20 w-20 shrink-0 rounded-md overflow-hidden bg-white/5">
                  <Image
                    src={item.imageUrl || '/placeholder-product.svg'}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-primary">{formatPrice(item.price)}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateQuantity(item.productId, item.variantId, item.quantity - 1)
                      }
                    >
                      −
                    </Button>
                    <span>{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateQuantity(item.productId, item.variantId, item.quantity + 1)
                      }
                    >
                      +
                    </Button>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeItem(item.productId, item.variantId)}
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </li>
            ))}
          </ul>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between font-semibold text-lg">
                <span>Subtotal</span>
                <span>{formatPrice(totalPrice)}</span>
              </div>
              <Link href="/checkout">
                <Button className="w-full" size="lg">
                  Proceed to checkout
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
