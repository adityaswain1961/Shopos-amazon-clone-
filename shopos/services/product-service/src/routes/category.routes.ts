import { Router, type Request, type Response, type NextFunction } from 'express';
import * as categoryController from '../controllers/category.controller.js';
import { authMiddleware, requireRoles } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { createCategorySchema } from '../validators/category.validators.js';

const router = Router();

// Category tree changes rarely — let the CDN hold it for 5 minutes.
const cacheable = (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  next();
};

router.get('/', cacheable, categoryController.listCategories);
router.post(
  '/',
  authMiddleware,
  requireRoles('admin', 'super_admin'),
  validateRequest({ body: createCategorySchema }),
  categoryController.createCategory,
);
router.get('/:slug', cacheable, categoryController.getCategoryBySlug);

export default router;
