'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/authStore';
import { createOrder } from '@/lib/api/orders';
import { getGuestCartId, formatPrice } from '@/lib/utils';
import type { ShippingAddress } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const REQUIRED: Array<keyof ShippingAddress> = ['fullName', 'line1', 'city', 'postalCode', 'phone'];

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const totalPrice = useCartStore((s) => s.totalPrice());
  const clearCart = useCartStore((s) => s.clearCart);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [address, setAddress] = useState<ShippingAddress>({
    fullName: '',
    line1: '',
    city: '',
    postalCode: '',
    phone: '',
    country: 'IN',
  });

  // One idempotency key per checkout attempt: a double click or a retry after
  // a network timeout returns the SAME order instead of placing two.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  async function handlePlaceOrder() {
    if (!isAuthenticated) {
      router.push('/login?redirect=/checkout');
      return;
    }
    const missing = REQUIRED.filter((k) => !String(address[k] ?? '').trim());
    if (missing.length) {
      setError('Please fill in all shipping fields.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const order = await createOrder({
        items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
        shippingAddress: address,
        couponCode: couponCode.trim() || undefined,
        cartId: getGuestCartId(),
        idempotencyKey: idempotencyKey.current,
      });
      clearCart();
      router.push(`/account/orders/${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Link href="/products">
          <Button className="mt-4">Shop now</Button>
        </Link>
      </div>
    );
  }

  const field = (key: keyof ShippingAddress, placeholder: string, extra?: Partial<React.InputHTMLAttributes<HTMLInputElement>>) => (
    <Input
      placeholder={placeholder}
      value={address[key] ?? ''}
      onChange={(e) => setAddress({ ...address, [key]: e.target.value })}
      {...extra}
    />
  );

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Checkout</h1>

      {!isAuthenticated && (
        <div className="mb-6 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm">
          <Link href="/login?redirect=/checkout" className="text-primary font-medium hover:underline">
            Sign in
          </Link>{' '}
          to complete your order.
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Shipping address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {field('fullName', 'Full name', { autoComplete: 'name', maxLength: 200 })}
            {field('line1', 'Address line', { autoComplete: 'address-line1', maxLength: 300 })}
            <div className="grid grid-cols-2 gap-3">
              {field('city', 'City', { autoComplete: 'address-level2', maxLength: 100 })}
              {field('postalCode', 'Postal code', { autoComplete: 'postal-code', maxLength: 20 })}
            </div>
            {field('phone', 'Phone', { autoComplete: 'tel', inputMode: 'tel', maxLength: 20 })}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Coupon code (optional)"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              maxLength={50}
            />
            <div className="flex justify-between font-semibold text-lg border-t border-border pt-4">
              <span>Estimated total</span>
              <span>{formatPrice(totalPrice)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Final prices and discounts are confirmed by the server when you place the order.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button className="w-full" size="lg" disabled={loading || !isAuthenticated} onClick={handlePlaceOrder}>
              {loading ? 'Placing order…' : 'Place order'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
