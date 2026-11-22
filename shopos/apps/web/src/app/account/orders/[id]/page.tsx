'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchOrder } from '@/lib/api/orders';
import { formatPrice } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// The checkout saga (stock → payment → confirmation) runs asynchronously.
const IN_PROGRESS = new Set(['inventory_pending', 'payment_pending']);

const STATUS_TEXT: Record<string, string> = {
  pending: 'Processing',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  payment_failed: 'Payment failed',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrder(id),
    enabled: !!id,
    // Poll with back-off only while the saga is running; stop once settled.
    refetchInterval: (query) => {
      const o = query.state.data;
      if (!o || !IN_PROGRESS.has(o.sagaStatus ?? '')) return false;
      return Math.min(2000 * 2 ** query.state.dataUpdateCount, 15000);
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !order) return <p className="text-muted-foreground">Order not found.</p>;

  const processing = IN_PROGRESS.has(order.sagaStatus ?? '');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Order {order.orderNumber}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Status <Badge>{STATUS_TEXT[order.status] ?? order.status}</Badge>
            {processing && <span className="text-sm font-normal text-muted-foreground">updating…</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {order.failureReason && (
            <p className="text-red-400">Reason: {order.failureReason.replace(/_/g, ' ')}</p>
          )}
          {order.items && order.items.length > 0 && (
            <ul className="divide-y divide-border/50">
              {order.items.map((it) => (
                <li key={`${it.productId}-${it.variantId ?? ''}`} className="flex justify-between py-2">
                  <span>
                    {it.productTitle} × {it.quantity}
                  </span>
                  <span>{formatPrice(Number(it.totalPrice), order.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          {Number(order.discountAmount ?? 0) > 0 && (
            <p>Discount: −{formatPrice(Number(order.discountAmount), order.currency)}</p>
          )}
          {order.totalAmount != null && (
            <p className="font-semibold">Total: {formatPrice(Number(order.totalAmount), order.currency)}</p>
          )}
          {order.createdAt && (
            <p className="text-muted-foreground">Placed: {new Date(order.createdAt).toLocaleString()}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
