'use client';

import { Card, CardContent } from '@/components/ui/card';

export default function AddressesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Addresses</h1>
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Saved addresses via <code className="text-primary">/api/v1/users/me/addresses</code>.
        </CardContent>
      </Card>
    </div>
  );
}
