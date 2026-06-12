'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

export default function OrdersPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Orders</h1>
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          <p>Order history loads from the order service after checkout.</p>
          <p className="mt-2">
            Place an order from{' '}
            <Link href="/checkout" className="text-primary hover:underline">
              checkout
            </Link>{' '}
            to see it here (order detail by ID).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
