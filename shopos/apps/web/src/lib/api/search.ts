import { API_URL } from './client';
import type { SearchResult } from '../types';

export async function searchProducts(q: string, limit = 20) {
  const res = await fetch(
    `${API_URL}/api/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    { headers: { 'X-Correlation-Id': crypto.randomUUID() } },
  );
  const json = await res.json();
  return (json.results ?? json.data ?? []) as SearchResult[];
}
