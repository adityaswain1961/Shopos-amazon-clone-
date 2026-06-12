'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { useLogout } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const links = [
  { href: '/account/profile', label: 'Profile' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/wishlist', label: 'Wishlist' },
  { href: '/account/addresses', label: 'Addresses' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const logout = useLogout();

  return (
    <AuthGuard>
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <div className="container mx-auto flex max-w-7xl flex-1 gap-8 px-4 py-8">
          <aside className="hidden w-48 shrink-0 md:block">
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
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground mt-4"
                onClick={() => logout.mutate()}
              >
                Sign out
              </Button>
            </nav>
          </aside>
          <div className="flex-1 min-w-0">{children}</div>
        </div>
        <Footer />
      </div>
    </AuthGuard>
  );
}
