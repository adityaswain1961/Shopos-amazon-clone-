'use client';

import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Input } from '@/components/ui/input';

export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <form onSubmit={onSubmit} className="relative w-full">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products..."
        className="pl-9"
      />
    </form>
  );
}
