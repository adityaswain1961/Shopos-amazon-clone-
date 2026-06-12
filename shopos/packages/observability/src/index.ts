import type { Request, Response, NextFunction, Express } from 'express';
import client from 'prom-client';

const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'shopos_',
});

export function createServiceMetrics(serviceName: string) {
  const httpRequestDuration = new client.Histogram({
    name: 'shopos_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['service', 'method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  const httpRequestsTotal = new client.Counter({
    name: 'shopos_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['service', 'method', 'route', 'status_code'] as const,
    registers: [register],
  });

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route?.path
        ? `${req.baseUrl}${req.route.path}`
        : req.path;
      const labels = {
        service: serviceName,
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };
      httpRequestDuration.observe(labels, durationSec);
      httpRequestsTotal.inc(labels);
    });
    next();
  };

  return { middleware, register };
}

export function setupMetrics(
  app: Express,
  serviceName: string,
): { middleware: ReturnType<typeof createServiceMetrics>['middleware'] } {
  const { middleware } = createServiceMetrics(serviceName);

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.get('/ready', (_req, res) => {
    res.json({ ready: true, service: serviceName });
  });

  return { middleware };
}

export { register, client };
