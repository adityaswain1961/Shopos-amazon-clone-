'use client';

import { Card, CardContent } from '@/components/ui/card';

export default function WishlistPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Wishlist</h1>
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Wishlists are managed by the user service. Connect your account to sync lists.
        </CardContent>
      </Card>
    </div>
  );
}
