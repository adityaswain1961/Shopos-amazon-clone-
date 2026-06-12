import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-border/40 py-10">
      <div className="container mx-auto max-w-7xl px-4">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <p className="font-bold text-lg">ShopOS</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Premium commerce powered by microservices.
            </p>
          </div>
          <div>
            <p className="font-medium text-sm">Shop</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li><Link href="/products" className="hover:text-foreground">All products</Link></li>
              <li><Link href="/search" className="hover:text-foreground">Search</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-sm">Account</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li><Link href="/account/orders" className="hover:text-foreground">Orders</Link></li>
              <li><Link href="/account/wishlist" className="hover:text-foreground">Wishlist</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-sm">Sell</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li><Link href="/seller/dashboard" className="hover:text-foreground">Seller dashboard</Link></li>
            </ul>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} ShopOS. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
