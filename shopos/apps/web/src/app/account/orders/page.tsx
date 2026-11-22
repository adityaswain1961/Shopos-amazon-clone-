'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchMyOrders } from '@/lib/api/orders';
import { formatPrice } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function OrdersPage() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['my-orders'],
    queryFn: ({ pageParam }) => fetchMyOrders(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const orders = data?.pages.flatMap((p) => p.orders) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Orders</h1>
      {isLoading && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-muted-foreground">Could not load your orders.</p>}
      {!isLoading && !error && orders.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            You have no orders yet.{' '}
            <Link href="/products" className="text-primary hover:underline">
              Start shopping
            </Link>
          </CardContent>
        </Card>
      )}
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/account/orders/${o.id}`}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="flex items-center justify-between py-4 text-sm">
                  <div>
                    <p className="font-medium">{o.orderNumber}</p>
                    {o.createdAt && (
                      <p className="text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {o.totalAmount != null && <span>{formatPrice(Number(o.totalAmount), o.currency)}</span>}
                    <Badge>{o.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <Button variant="outline" className="mt-4" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
