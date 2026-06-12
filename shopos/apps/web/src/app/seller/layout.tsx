'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

const links = [
  { href: '/seller/dashboard', label: 'Dashboard' },
  { href: '/seller/products', label: 'Products' },
  { href: '/seller/orders', label: 'Orders' },
  { href: '/seller/analytics', label: 'Analytics' },
];

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hasRole = useAuthStore((s) => s.hasRole);

  return (
    <AuthGuard>
      <div className="flex min-h-screen flex-col">
        <Navbar />
        {!hasRole('seller') && !hasRole('admin') ? (
          <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">
            Seller access required. Contact support to enable your seller account.
          </div>
        ) : (
          <div className="container mx-auto flex max-w-7xl flex-1 gap-8 px-4 py-8">
            <aside className="hidden w-48 md:block">
              <nav className="space-y-1">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn(
                      'block rounded-md px-3 py-2 text-sm',
                      pathname === l.href
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
            </aside>
            <div className="flex-1">{children}</div>
          </div>
        )}
        <Footer />
      </div>
    </AuthGuard>
  );
}
