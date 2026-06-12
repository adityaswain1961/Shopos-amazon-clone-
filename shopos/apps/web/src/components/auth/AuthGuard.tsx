'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isAuthenticated()) {
      router.replace('/login');
    }
  }, [mounted, isAuthenticated, router]);

  if (!mounted) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated()) return null;

  return <>{children}</>;
}
