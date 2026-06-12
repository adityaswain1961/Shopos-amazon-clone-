'use client';

import Link from 'next/link';
import { ShoppingCart, User, LayoutDashboard } from 'lucide-react';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';
import { SearchBar } from './SearchBar';

export function Navbar() {
  const totalItems = useCartStore((s) => s.totalItems());
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const user = useAuthStore((s) => s.user);
  const hasRole = useAuthStore((s) => s.hasRole);
  const setCartOpen = useUiStore((s) => s.setCartOpen);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-bold text-xl tracking-tight">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">
            ShopOS
          </span>
        </Link>

        <div className="hidden flex-1 md:flex md:max-w-md lg:max-w-lg">
          <SearchBar />
        </div>

        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href="/products"
            className="hidden px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:inline"
          >
            Shop
          </Link>

          {hasRole('seller') && (
            <Link href="/seller/dashboard">
              <Button variant="ghost" size="sm" className="gap-1">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Seller</span>
              </Button>
            </Link>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="relative gap-1"
            onClick={() => setCartOpen(true)}
            aria-label="Open cart"
          >
            <ShoppingCart className="h-5 w-5" />
            {totalItems > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {totalItems > 9 ? '9+' : totalItems}
              </span>
            )}
          </Button>

          {isAuthenticated ? (
            <Link href="/account/profile">
              <Button variant="ghost" size="sm" className="gap-1">
                <User className="h-4 w-4" />
                <span className="hidden max-w-[100px] truncate sm:inline">
                  {user?.email?.split('@')[0]}
                </span>
              </Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="outline" size="sm">
                Sign in
              </Button>
            </Link>
          )}
        </nav>
      </div>

      <div className="border-t border-border/40 px-4 py-2 md:hidden">
        <SearchBar />
      </div>
    </header>
  );
}
