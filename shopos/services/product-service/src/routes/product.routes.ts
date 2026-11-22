import { Router } from 'express';
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from '../controllers/product.controller.js';
import { authMiddleware, optionalAuth, requireRoles } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  createProductSchema,
  updateProductSchema,
  productListQuerySchema,
} from '../validators/product.validators.js';

const router = Router();

const SELLER_ROLES = ['seller', 'admin', 'super_admin'];
const writeLimit = rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:products:write' });

// Public reads — no per-request Redis rate limiting here: they are served
// from CDN/Kong cache and Redis, and the gateway applies a global limit.
router.get('/', optionalAuth, validateRequest({ query: productListQuerySchema }), getProducts);
router.get('/:id', optionalAuth, getProductById);

// Seller/admin writes
router.post(
  '/',
  authMiddleware,
  requireRoles(...SELLER_ROLES),
  writeLimit,
  validateRequest({ body: createProductSchema }),
  createProduct,
);
router.patch(
  '/:id',
  authMiddleware,
  requireRoles(...SELLER_ROLES),
  writeLimit,
  validateRequest({ body: updateProductSchema }),
  updateProduct,
);
router.delete('/:id', authMiddleware, requireRoles(...SELLER_ROLES), writeLimit, deleteProduct);

export default router;
