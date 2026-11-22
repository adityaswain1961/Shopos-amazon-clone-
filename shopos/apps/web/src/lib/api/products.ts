import { apiFetch } from './client';
import type { Product } from '../types';

export async function fetchProducts(params?: { limit?: number; categorySlug?: string; sort?: string }) {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.categorySlug) q.set('categorySlug', params.categorySlug);
  if (params?.sort) q.set('sort', params.sort);
  const query = q.toString() ? `?${q}` : '';
  return apiFetch<Product[]>(`/api/v1/products${query}`);
}

export async function fetchProduct(idOrSlug: string) {
  return apiFetch<Product>(`/api/v1/products/${encodeURIComponent(idOrSlug)}`);
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
