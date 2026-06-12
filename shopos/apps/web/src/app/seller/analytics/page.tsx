import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SellerAnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>
      <Card>
        <CardHeader>
          <CardTitle>Sales overview</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Connect to <code className="text-primary">/api/v1/analytics/dashboard</code> for
          GMV, conversion, and product performance metrics.
        </CardContent>
      </Card>
    </div>
  );
}
