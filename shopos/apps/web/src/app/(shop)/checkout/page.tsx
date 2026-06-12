'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/authStore';
import { createOrder } from '@/lib/api/orders';
import { getGuestCartId, formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const totalPrice = useCartStore((s) => s.totalPrice());
  const clearCart = useCartStore((s) => s.clearCart);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [address, setAddress] = useState({
    fullName: '',
    line1: '',
    city: '',
    postalCode: '',
    phone: '',
  });

  async function handlePlaceOrder() {
    if (!isAuthenticated || !user) {
      router.push('/login?redirect=/checkout');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const order = await createOrder({
        userId: user.id,
        cartId: getGuestCartId(),
        totalAmount: totalPrice,
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
            <Input
              placeholder="Full name"
              value={address.fullName}
              onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
            />
            <Input
              placeholder="Address line"
              value={address.line1}
              onChange={(e) => setAddress({ ...address, line1: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="City"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
              />
              <Input
                placeholder="Postal code"
                value={address.postalCode}
                onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
              />
            </div>
            <Input
              placeholder="Phone"
              value={address.phone}
              onChange={(e) => setAddress({ ...address, phone: e.target.value })}
            />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Demo checkout — places order via saga (inventory → payment).
            </p>
            <div className="flex justify-between font-semibold text-lg border-t border-border pt-4">
              <span>Total</span>
              <span>{formatPrice(totalPrice)}</span>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button
              className="w-full"
              size="lg"
              disabled={loading || !isAuthenticated}
              onClick={handlePlaceOrder}
            >
              {loading ? 'Placing order…' : 'Place order'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
