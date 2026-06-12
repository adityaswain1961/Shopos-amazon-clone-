import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SellerDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Seller dashboard</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s sales</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground">Analytics service</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open orders</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Products</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
