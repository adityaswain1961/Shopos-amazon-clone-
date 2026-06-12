import { ProductGrid } from '@/components/product/ProductGrid';

export const metadata = { title: 'Products' };

export default function ProductsPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">All products</h1>
      <p className="text-muted-foreground mb-8">Browse our catalog</p>
      <ProductGrid />
    </div>
  );
}
