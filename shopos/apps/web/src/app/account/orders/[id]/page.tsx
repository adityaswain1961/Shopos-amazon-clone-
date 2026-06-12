'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchOrder } from '@/lib/api/orders';
import { formatPrice } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrder(id),
    enabled: !!id,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  if (error || !order) {
    return <p className="text-muted-foreground">Order not found.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Order {order.orderNumber}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Status <Badge>{order.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Order ID: <code>{order.id}</code></p>
          {order.totalAmount != null && (
            <p>Total: {formatPrice(Number(order.totalAmount))}</p>
          )}
          {order.createdAt && (
            <p className="text-muted-foreground">
              Placed: {new Date(order.createdAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
