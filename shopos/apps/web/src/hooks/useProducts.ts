'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchProduct } from '@/lib/api/products';

export function useProducts(status?: string) {
  return useQuery({
    queryKey: ['products', status ?? 'all'],
    queryFn: () => fetchProducts({ status, limit: 50 }),
    staleTime: 60_000,
  });
}

export function useProduct(idOrSlug: string) {
  return useQuery({
    queryKey: ['product', idOrSlug],
    queryFn: () => fetchProduct(idOrSlug),
    enabled: !!idOrSlug,
  });
}
