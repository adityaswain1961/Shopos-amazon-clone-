import { Card, CardContent } from '@/components/ui/card';

export default function SellerOrdersPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Seller orders</h1>
      <Card>
        <CardContent className="py-8 text-muted-foreground text-sm">
          Sub-orders for your seller ID via order service seller endpoints.
        </CardContent>
      </Card>
    </div>
  );
}
