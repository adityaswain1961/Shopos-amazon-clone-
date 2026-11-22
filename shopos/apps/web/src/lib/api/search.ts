import { apiFetch } from './client';
import type { SearchResult } from '../types';

export function searchProducts(q: string, limit = 20) {
  return apiFetch<SearchResult[]>(`/api/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}
