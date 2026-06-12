'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { searchProducts } from '@/lib/api/search';
import { formatPrice } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

function SearchResults() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';

  const { data, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchProducts(q),
    enabled: q.length > 0,
  });

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">
        {q ? `Results for “${q}”` : 'Search'}
      </h1>

      {!q && (
        <p className="mt-4 text-muted-foreground">Enter a query in the search bar above.</p>
      )}

      {isLoading && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {q && !isLoading && (
        <div className="mt-8">
          {data?.length === 0 ? (
            <p className="text-muted-foreground">No results found. Try another term.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {data?.map((item, i) => (
                <li key={item.id ?? i} className="py-4">
                  <Link
                    href={item.slug ? `/products/${item.slug}` : '#'}
                    className="flex justify-between hover:text-primary"
                  >
                    <span className="font-medium">{item.title ?? 'Product'}</span>
                    {item.price && (
                      <span className="text-muted-foreground">{formatPrice(item.price)}</span>
                    )}
                  </Link>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {item.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container px-4 py-8 text-muted-foreground">Loading search…</div>}>
      <SearchResults />
    </Suspense>
  );
}
