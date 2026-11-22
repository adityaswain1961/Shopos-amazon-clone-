import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { fetchProductServer } from '@/lib/api/server';
import { formatPrice } from '@/lib/utils';
import { AddToCart } from '@/components/product/AddToCart';

// Rendered on the server and cached for 60s (ISR). The HTML is identical for
// every visitor, so it can also be cached by the CDN: a product that goes
// viral costs one render per minute, not one per visitor.
export const revalidate = 60;

// Empty list = don't pre-build any product at deploy time, but cache each
// product page after its first request (on-demand ISR) instead of rendering
// it per request.
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProductServer(slug).catch(() => null);
  if (!product) return { title: 'Product not found' };
  const image = product.images?.find((i) => i.isPrimary) ?? product.images?.[0];
  return {
    title: product.seoTitle || product.title,
    description: product.seoDescription || product.description?.slice(0, 160) || undefined,
    openGraph: image?.url ? { images: [image.url] } : undefined,
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = await fetchProductServer(slug);
  if (!product) notFound();

  const price = Number(product.basePrice);
  const compare = product.comparePrice ? Number(product.comparePrice) : null;
  const image = product.images?.find((i) => i.isPrimary) ?? product.images?.[0];
  const variantId = product.variants?.[0]?.id ?? 'default';

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="grid md:grid-cols-2 gap-10">
        <div className="relative aspect-square rounded-xl overflow-hidden bg-white/5 border border-border/50">
          {image?.url ? (
            <Image
              src={image.url}
              alt={image.altText || product.title}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          ) : (
            <Image src="/placeholder-product.svg" alt="" fill className="object-contain p-8" />
          )}
        </div>
        <div>
          <h1 className="text-3xl font-bold">{product.title}</h1>
          {product.category && <p className="text-sm text-muted-foreground mt-1">{product.category.name}</p>}
          <p className="text-3xl font-semibold text-primary mt-4">
            {formatPrice(price, product.currency)}
            {compare && compare > price && (
              <span className="ml-3 text-lg text-muted-foreground line-through">
                {formatPrice(compare, product.currency)}
              </span>
            )}
          </p>
          {product.status === 'out_of_stock' && (
            <p className="mt-2 text-sm font-medium text-red-400">Currently out of stock</p>
          )}
          {product.description && (
            <p className="mt-6 text-muted-foreground leading-relaxed whitespace-pre-line">{product.description}</p>
          )}
          {product.highlights && product.highlights.length > 0 && (
            <ul className="mt-4 list-disc list-inside text-sm text-muted-foreground space-y-1">
              {product.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          <AddToCart
            disabled={product.status !== 'published'}
            item={{
              productId: product.id,
              variantId,
              name: product.title,
              price,
              imageUrl: image?.url ?? '/placeholder-product.svg',
              slug: product.slug,
            }}
          />
        </div>
      </div>
    </div>
  );
}
