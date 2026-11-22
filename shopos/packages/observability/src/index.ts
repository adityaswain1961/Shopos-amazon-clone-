import type { Request, Response, NextFunction, Express } from 'express';
import client from 'prom-client';

const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'shopos_',
});

// ─── Readiness / graceful drain ─────────────────────────────────────
// Kubernetes stops routing traffic to a pod as soon as /ready fails.
// On SIGTERM we flip this flag first, wait for the load balancer to notice,
// then close the HTTP server — so in-flight requests are never dropped.

let shuttingDown = false;

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export type ReadinessCheck = () => boolean | Promise<boolean>;

export interface SetupMetricsOptions {
  /** Named dependency checks (db, redis, ...). All must pass for /ready to return 200. */
  readinessChecks?: Record<string, ReadinessCheck>;
}

export function createServiceMetrics(serviceName: string) {
  // prom-client throws if the same metric is registered twice (e.g. in tests).
  const existingDuration = register.getSingleMetric('shopos_http_request_duration_seconds');
  const existingTotal = register.getSingleMetric('shopos_http_requests_total');

  const httpRequestDuration =
    (existingDuration as client.Histogram<'service' | 'method' | 'route' | 'status_code'>) ??
    new client.Histogram({
      name: 'shopos_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['service', 'method', 'route', 'status_code'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [register],
    });

  const httpRequestsTotal =
    (existingTotal as client.Counter<'service' | 'method' | 'route' | 'status_code'>) ??
    new client.Counter({
      name: 'shopos_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['service', 'method', 'route', 'status_code'] as const,
      registers: [register],
    });

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      // Only use the matched route *template* as a label. Falling back to the
      // raw path would create one time series per product id / per 404 probe
      // and eventually take Prometheus down under real traffic.
      const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
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
  options: SetupMetricsOptions = {},
): { middleware: ReturnType<typeof createServiceMetrics>['middleware'] } {
  const { middleware } = createServiceMetrics(serviceName);
  const checks = options.readinessChecks ?? {};

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.get('/ready', async (_req, res) => {
    if (shuttingDown) {
      res.status(503).json({ ready: false, service: serviceName, reason: 'shutting_down' });
      return;
    }

    const results: Record<string, boolean> = {};
    await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          results[name] = Boolean(await withTimeout(Promise.resolve(check()), 1500));
        } catch {
          results[name] = false;
        }
      }),
    );

    const ready = Object.values(results).every(Boolean);
    res.status(ready ? 200 : 503).json({ ready, service: serviceName, checks: results });
  });

  return { middleware };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Standard graceful shutdown for an HTTP server:
 *  1. mark not-ready so the load balancer stops sending new requests
 *  2. wait `drainMs` for endpoints to propagate
 *  3. stop accepting connections, let in-flight requests finish
 *  4. run cleanup (close DB / Kafka / Redis)
 */
export function registerGracefulShutdown(
  server: { close: (cb: (err?: Error) => void) => void; closeIdleConnections?: () => void },
  cleanup: () => Promise<void>,
  opts: { drainMs?: number; timeoutMs?: number; log?: (msg: string) => void } = {},
): void {
  const drainMs = opts.drainMs ?? Number(process.env.SHUTDOWN_DRAIN_MS ?? 5000);
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const log = opts.log ?? ((m: string) => console.log(m));
  let started = false;

  const shutdown = (signal: string) => {
    if (started) return;
    started = true;
    log(`Received ${signal}; draining for ${drainMs}ms before shutdown`);
    markShuttingDown();

    const force = setTimeout(() => {
      log('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, timeoutMs);
    force.unref();

    setTimeout(() => {
      server.close(async () => {
        try {
          await cleanup();
          log('Shutdown complete');
          process.exit(0);
        } catch {
          process.exit(1);
        }
      });
      server.closeIdleConnections?.();
    }, drainMs);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { register, client };
