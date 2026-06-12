import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validators/auth.validators.js';

const router = Router();

// ─── Public Routes (no auth) ────────────────────────────────────────

router.post(
  '/register',
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:register' }),
  validateRequest({ body: registerSchema }),
  authController.register,
);

router.post(
  '/login',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:login' }),
  validateRequest({ body: loginSchema }),
  authController.login,
);

router.post(
  '/refresh',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:refresh' }),
  validateRequest({ body: refreshSchema }),
  authController.refresh,
);

router.get(
  '/verify-email',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:verify' }),
  validateRequest({ query: verifyEmailSchema }),
  authController.verifyEmail,
);

router.post(
  '/forgot-password',
  rateLimiter({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'rl:forgot' }),
  validateRequest({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);

router.post(
  '/reset-password',
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:reset' }),
  validateRequest({ body: resetPasswordSchema }),
  authController.resetPassword,
);

// ─── Protected Routes (auth required) ───────────────────────────────

router.post(
  '/logout',
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:logout' }),
  authMiddleware,
  authController.logout,
);

router.get(
  '/sessions',
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:sessions' }),
  authMiddleware,
  authController.listSessions,
);

router.delete(
  '/sessions/:sessionId',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:revoke-session' }),
  authMiddleware,
  authController.revokeSession,
);

router.delete(
  '/sessions',
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:revoke-all' }),
  authMiddleware,
  authController.revokeAllSessions,
);

export default router;
