'use client';

import { useProducts } from '@/hooks/useProducts';
import { ProductCard } from './ProductCard';
import { Skeleton } from '@/components/ui/skeleton';

export function ProductGrid({ categorySlug, sort }: { categorySlug?: string; sort?: string }) {
  const { data, isLoading, error } = useProducts({ categorySlug, sort });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-center text-muted-foreground py-12">
        Could not load products. Is the API running at{' '}
        <code className="text-primary">{process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}</code>?
      </p>
    );
  }

  const products = data ?? [];

  if (products.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-12">
        No products yet. Create some via the product API (status: published).
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
