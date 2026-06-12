import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
  slug: z.string().min(2, 'Slug must be at least 2 characters').max(100, 'Slug must be at most 100 characters').optional(),
  description: z.string().max(500, 'Description must be at most 500 characters').optional().nullable(),
  parentId: z.string().uuid('Parent ID must be a valid UUID').optional().nullable(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const categoryIdParamSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID'),
});

export const categoryIdOrSlugParamSchema = z.object({
  idOrSlug: z.string().min(1, 'ID or slug is required'),
});
