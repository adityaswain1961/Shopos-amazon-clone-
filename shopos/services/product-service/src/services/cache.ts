import crypto from 'node:crypto';
import { getRedisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Read-through cache for hot catalog reads.
 *
 * Layers (cheapest first): CDN / Kong proxy-cache (HTTP headers) → Redis →
 * Postgres. Properties that matter at 1M concurrent users:
 *  - single-flight: N concurrent misses for the same key in one pod cause ONE
 *    DB query, not N (prevents a cache stampede when a hot key expires)
 *  - TTL jitter: keys written together don't all expire in the same second
 *  - negative caching: unknown slugs (bots, typos) are cached as "missing"
 *  - Redis down ⇒ fall through to the DB instead of failing the request
 */

const NULL_SENTINEL = '__null__';
const inflight = new Map<string, Promise<unknown>>();

function jitter(ttlSeconds: number): number {
  return Math.max(1, Math.round(ttlSeconds * (0.9 + Math.random() * 0.2)));
}

export async function getOrLoad<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T | null>,
  opts: { negativeTtlSeconds?: number } = {},
): Promise<T | null> {
  const redis = getRedisClient();

  try {
    const cached = await redis.get(key);
    if (cached === NULL_SENTINEL) return null;
    if (cached !== null) return JSON.parse(cached) as T;
  } catch (err) {
    logger.debug('cache read failed, falling back to DB', { key, err: (err as Error).message });
  }

  const existing = inflight.get(key) as Promise<T | null> | undefined;
  if (existing) return existing;

  const p = (async () => {
    try {
      const value = await loader();
      try {
        if (value === null || value === undefined) {
          await redis.set(key, NULL_SENTINEL, 'EX', opts.negativeTtlSeconds ?? 30);
        } else {
          await redis.set(key, JSON.stringify(value), 'EX', jitter(ttlSeconds));
        }
      } catch {
        /* cache write is best-effort */
      }
      return value ?? null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getRedisClient().del(...keys);
  } catch (err) {
    logger.warn('cache invalidation failed', { keys, err: (err as Error).message });
  }
}

// ─── Generation-based invalidation for list pages ───────────────────
// List pages have unbounded key space (filters × cursors). Instead of
// scanning for keys on every write, embed a generation number in the key and
// bump it: all old list pages become unreachable and simply expire.

const GEN_KEY = 'products:v2:listgen';
let localGen: { value: string; at: number } | null = null;

export async function listGeneration(): Promise<string> {
  // Cache the generation in-process for 1s: saves a Redis round trip on the
  // hottest endpoint while keeping staleness negligible.
  if (localGen && Date.now() - localGen.at < 1000) return localGen.value;
  try {
    const v = (await getRedisClient().get(GEN_KEY)) ?? '0';
    localGen = { value: v, at: Date.now() };
    return v;
  } catch {
    return localGen?.value ?? '0';
  }
}

export async function bumpListGeneration(): Promise<void> {
  try {
    await getRedisClient().incr(GEN_KEY);
    localGen = null;
  } catch (err) {
    logger.warn('failed to bump list cache generation', { err: (err as Error).message });
  }
}

export function hashKey(obj: unknown): string {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('base64url');
}
