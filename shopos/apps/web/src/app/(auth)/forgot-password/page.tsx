'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { forgotPassword } from '@/lib/api/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: () => forgotPassword(email),
    onSuccess: () => setSent(true),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset password</CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="text-sm text-muted-foreground">
            If an account exists for {email}, you will receive a reset link shortly.
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              Send reset link
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
