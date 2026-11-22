'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchProduct } from '@/lib/api/products';

/** Published products, newest first (the API only returns published items to shoppers). */
export function useProducts(params?: { categorySlug?: string; sort?: string; limit?: number }) {
  return useQuery({
    queryKey: ['products', params ?? {}],
    queryFn: () => fetchProducts({ limit: 24, ...params }),
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
