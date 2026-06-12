import Link from 'next/link';
import { ArrowRight, Zap, Shield, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductGrid } from '@/components/product/ProductGrid';

export default function HomePage() {
  return (
    <div className="pb-16">
      <section className="container mx-auto max-w-7xl px-4 pt-16 pb-12 text-center">
        <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6">
          <Sparkles className="mr-2 h-4 w-4" />
          ShopOS v1.0
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight max-w-3xl mx-auto">
          Shop smarter on{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">
            ShopOS
          </span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
          Microservice-powered commerce with real-time cart, secure checkout, and personalized search.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/products">
            <Button size="lg">
              Browse products <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="/register">
            <Button size="lg" variant="outline">
              Create account
            </Button>
          </Link>
        </div>
      </section>

      <section className="container mx-auto max-w-7xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Featured products</h2>
          <Link href="/products" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        <ProductGrid />
      </section>

      <section className="container mx-auto max-w-7xl px-4 mt-20 grid md:grid-cols-3 gap-6">
        <div className="p-6 rounded-xl border border-border/50 bg-card">
          <Zap className="h-8 w-8 text-primary mb-3" />
          <h3 className="font-bold">Fast cart</h3>
          <p className="text-sm text-muted-foreground mt-1">Rust cart service with Redis for sub-ms updates.</p>
        </div>
        <div className="p-6 rounded-xl border border-border/50 bg-card">
          <Shield className="h-8 w-8 text-primary mb-3" />
          <h3 className="font-bold">Secure checkout</h3>
          <p className="text-sm text-muted-foreground mt-1">JWT auth and saga-orchestrated orders.</p>
        </div>
        <div className="p-6 rounded-xl border border-border/50 bg-card">
          <Sparkles className="h-8 w-8 text-primary mb-3" />
          <h3 className="font-bold">Smart search</h3>
          <p className="text-sm text-muted-foreground mt-1">Elasticsearch-powered product discovery.</p>
        </div>
      </section>
    </div>
  );
}
