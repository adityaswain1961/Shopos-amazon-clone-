import { Router } from 'express';
import * as tokenService from '../services/tokenService.js';

const router = Router();

/**
 * GET /.well-known/jwks.json
 *
 * Public endpoint — returns the RS256 public key(s) as a standard JWK Set.
 *
 * IMPORTANT: this must be the raw RFC 7517 document `{ "keys": [...] }`,
 * NOT wrapped in the usual `{ success, data }` API envelope — jose, Spring
 * Security, ASP.NET JwtBearer, PyJWT and Kong all expect the raw shape.
 *
 * Responses are cacheable by the CDN/gateway; downstream services also cache
 * the key set in memory, so auth-service is not on the hot path of requests.
 */
router.get('/.well-known/jwks.json', async (_req, res, next) => {
  try {
    const jwks = await tokenService.getJWKS();
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600');
    res.json(jwks);
  } catch (error) {
    next(error);
  }
});

export default router;
