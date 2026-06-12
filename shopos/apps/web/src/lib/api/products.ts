import { apiFetch } from './client';
import type { Product } from '../types';

export async function fetchProducts(params?: { status?: string; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.limit) q.set('limit', String(params.limit));
  const query = q.toString() ? `?${q}` : '';
  return apiFetch<Product[]>(`/api/v1/products${query}`);
}

export async function fetchProduct(idOrSlug: string) {
  return apiFetch<Product>(`/api/v1/products/${idOrSlug}`);
}

export async function fetchCategories() {
  return apiFetch<
    Array<{
      id: string;
      name: string;
      slug: string;
      children?: unknown[];
    }>
  >('/api/v1/products/categories');
}
