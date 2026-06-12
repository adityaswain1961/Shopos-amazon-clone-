'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart } from 'lucide-react';
import type { Product } from '@/lib/types';
import { formatPrice, cn } from '@/lib/utils';
import { useCartStore } from '@/store/useCartStore';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ProductCardProps {
  product: Product;
  className?: string;
}

export function ProductCard({ product, className }: ProductCardProps) {
  const addItem = useCartStore((s) => s.addItem);
  const setCartOpen = useUiStore((s) => s.setCartOpen);

  const price = Number(product.basePrice);
  const compare = product.comparePrice ? Number(product.comparePrice) : null;
  const image = product.images?.find((i) => i.isPrimary) ?? product.images?.[0];
  const variantId = product.variants?.[0]?.id ?? 'default';

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    addItem({
      productId: product.id,
      variantId,
      name: product.title,
      price,
      quantity: 1,
      imageUrl: image?.url ?? '/placeholder-product.svg',
      slug: product.slug,
    });
    setCartOpen(true);
  }

  return (
    <Link
      href={`/products/${product.slug}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-border/50 bg-card transition-shadow hover:shadow-lg',
        className,
      )}
    >
      <div className="relative aspect-square bg-white/5">
        {image?.url ? (
          <Image
            src={image.url}
            alt={product.title}
            fill
            className="object-cover transition-transform group-hover:scale-105"
            sizes="(max-width: 768px) 50vw, 25vw"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            No image
          </div>
        )}
        {product.status === 'published' && (
          <Badge className="absolute left-2 top-2">In stock</Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 font-medium leading-snug group-hover:text-primary">
          {product.title}
        </h3>
        <div className="mt-auto flex items-center justify-between pt-3">
          <div>
            <span className="font-semibold">{formatPrice(price, product.currency)}</span>
            {compare && compare > price && (
              <span className="ml-2 text-sm text-muted-foreground line-through">
                {formatPrice(compare, product.currency)}
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={handleAdd} aria-label="Add to cart">
            <ShoppingCart className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Link>
  );
}
