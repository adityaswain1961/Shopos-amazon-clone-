'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRegister, getAuthErrorMessage } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function RegisterPage() {
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <p className="text-sm text-muted-foreground">
          Password: 8+ chars, upper, lower, digit, special.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            register.mutate({ name, email, password });
          }}
        >
          <Input
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {register.isError && (
            <p className="text-sm text-red-400">{getAuthErrorMessage(register.error)}</p>
          )}
          <Button type="submit" className="w-full" disabled={register.isPending}>
            {register.isPending ? 'Creating…' : 'Register'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
