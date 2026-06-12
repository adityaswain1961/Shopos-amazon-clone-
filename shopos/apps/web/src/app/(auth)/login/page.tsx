'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLogin, getAuthErrorMessage } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function LoginForm() {
  const params = useSearchParams();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        {params.get('registered') && (
          <p className="text-sm text-green-400">Account created. Please sign in.</p>
        )}
        {params.get('redirect') && (
          <p className="text-sm text-muted-foreground">Sign in to continue checkout.</p>
        )}
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate({ email, password });
          }}
        >
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {login.isError && (
            <p className="text-sm text-red-400">{getAuthErrorMessage(login.error)}</p>
          )}
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="text-primary hover:underline">
            Forgot password?
          </Link>
        </p>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          No account?{' '}
          <Link href="/register" className="text-primary hover:underline">
            Register
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-center text-muted-foreground">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
