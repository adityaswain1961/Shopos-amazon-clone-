import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-4">
        <Link href="/" className="font-bold text-primary">
          ShopOS Admin
        </Link>
      </header>
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-2xl font-bold mb-6">Admin console</h1>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Platform</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              User management, coupons, and system health — wire to admin API routes.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Observability</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <a href="http://localhost:3030" className="text-primary hover:underline" target="_blank" rel="noreferrer">
                Grafana
              </a>
              {' · '}
              <a href="http://localhost:9090" className="text-primary hover:underline" target="_blank" rel="noreferrer">
                Prometheus
              </a>
            </CardContent>
          </Card>
        </div>
        <Link href="/" className="inline-block mt-8 text-sm text-primary hover:underline">
          ← Back to store
        </Link>
      </main>
    </div>
  );
}
