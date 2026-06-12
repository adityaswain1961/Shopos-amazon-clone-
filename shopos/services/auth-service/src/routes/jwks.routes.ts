import { Router } from 'express';
import * as tokenService from '../services/tokenService.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = Router();

/**
 * GET /.well-known/jwks.json
 *
 * Public endpoint — returns the RS256 public key in JWKS format.
 * Kong and all downstream services use this to verify JWTs without
 * making a network call to the auth service on every request.
 *
 * No authentication required. Cached by consumers.
 */
router.get('/.well-known/jwks.json', async (_req, res, next) => {
  try {
    const jwks = await tokenService.getJWKS();

    // Allow aggressive caching — key rotation is infrequent
    res.set('Cache-Control', 'public, max-age=3600');

    sendSuccess(res, jwks);
  } catch (error) {
    next(error);
  }
});

export default router;
