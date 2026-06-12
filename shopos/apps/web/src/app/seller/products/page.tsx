import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function SellerProductsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Your products</h1>
        <Button disabled>Add product</Button>
      </div>
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Manage products via{' '}
          <code className="text-primary">POST /api/v1/products</code> (seller JWT).
          <Link href="/products" className="block mt-4 text-primary hover:underline">
            View storefront →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
