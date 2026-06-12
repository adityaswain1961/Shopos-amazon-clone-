'use client';

import { useAuthStore } from '@/store/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Profile</h1>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">Email:</span>{' '}
            {user?.email}
          </p>
          <p>
            <span className="text-muted-foreground">User ID:</span>{' '}
            <code className="text-xs">{user?.id}</code>
          </p>
          <div className="flex gap-2 flex-wrap">
            {user?.roles?.map((r) => (
              <Badge key={r}>{r}</Badge>
            ))}
          </div>
          {user?.isEmailVerified === false && (
            <p className="text-amber-400">Please verify your email address.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
