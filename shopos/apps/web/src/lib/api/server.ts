import 'server-only';
import type { ApiResponse, Product } from '../types';

// Inside the cluster/compose network the web server talks to Kong directly.
const BASE = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/**
 * Product fetch for React Server Components. `revalidate: 60` enables
 * incremental static regeneration: the rendered page is cached and re-built
 * at most once a minute per product, so a product going viral costs one
 * render per minute instead of one per visitor — and the CDN can cache the HTML.
 */
export async function fetchProductServer(slug: string): Promise<Product | null> {
  const res = await fetch(`${BASE}/api/v1/products/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`product fetch failed: ${res.status}`);
  const json = (await res.json()) as ApiResponse<Product>;
  return json.data ?? null;
}
