'use client';

import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useState } from 'react';
import { useProduct } from '@/hooks/useProducts';
import { useCartStore } from '@/store/useCartStore';
import { useUiStore } from '@/store/uiStore';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ShoppingCart } from 'lucide-react';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading, error } = useProduct(slug);
  const addItem = useCartStore((s) => s.addItem);
  const setCartOpen = useUiStore((s) => s.setCartOpen);
  const [qty, setQty] = useState(1);

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8 grid md:grid-cols-2 gap-8">
        <Skeleton className="aspect-square w-full" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-6 w-1/4" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">
        Product not found.
      </div>
    );
  }

  const price = Number(product.basePrice);
  const image = product.images?.find((i) => i.isPrimary) ?? product.images?.[0];
  const variantId = product.variants?.[0]?.id ?? 'default';

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="grid md:grid-cols-2 gap-10">
        <div className="relative aspect-square rounded-xl overflow-hidden bg-white/5 border border-border/50">
          {image?.url ? (
            <Image src={image.url} alt={product.title} fill className="object-cover" unoptimized />
          ) : (
            <Image src="/placeholder-product.svg" alt="" fill className="object-contain p-8" />
          )}
        </div>
        <div>
          <h1 className="text-3xl font-bold">{product.title}</h1>
          {product.category && (
            <p className="text-sm text-muted-foreground mt-1">{product.category.name}</p>
          )}
          <p className="text-3xl font-semibold text-primary mt-4">
            {formatPrice(price, product.currency)}
          </p>
          {product.description && (
            <p className="mt-6 text-muted-foreground leading-relaxed">{product.description}</p>
          )}
          {product.highlights && product.highlights.length > 0 && (
            <ul className="mt-4 list-disc list-inside text-sm text-muted-foreground space-y-1">
              {product.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          <div className="mt-8 flex items-center gap-4">
            <div className="flex items-center border border-border rounded-md">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                −
              </Button>
              <span className="w-10 text-center">{qty}</span>
              <Button variant="ghost" size="sm" onClick={() => setQty((q) => q + 1)}>
                +
              </Button>
            </div>
            <Button
              size="lg"
              className="flex-1 gap-2"
              onClick={() => {
                addItem({
                  productId: product.id,
                  variantId,
                  name: product.title,
                  price,
                  quantity: qty,
                  imageUrl: image?.url ?? '/placeholder-product.svg',
                  slug: product.slug,
                });
                setCartOpen(true);
              }}
            >
              <ShoppingCart className="h-5 w-5" />
              Add to cart
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
