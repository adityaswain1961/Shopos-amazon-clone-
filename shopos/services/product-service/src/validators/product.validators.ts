import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(200, 'Name must be at most 200 characters'),
  slug: z.string().min(2, 'Slug must be at least 2 characters').max(200, 'Slug must be at most 200 characters').optional(),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  sku: z.string().min(3, 'SKU must be at least 3 characters'),
  price: z.coerce.number().positive('Price must be a positive number'),
  compareAtPrice: z.coerce.number().positive('Compare at price must be positive').optional().nullable(),
  currency: z.string().default('INR'),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  brand: z.string().min(1, 'Brand is required'),
  attributes: z.record(z.any()).default({}),
  tags: z.array(z.string()).default([]),
  weight: z.coerce.number().positive().optional().nullable(),
  dimensions: z.object({
    width: z.coerce.number().positive(),
    height: z.coerce.number().positive(),
    length: z.coerce.number().positive(),
  }).optional().nullable(),
  categoryId: z.string().uuid('Category ID must be a valid UUID'),
  inventoryGroupId: z.string().optional().nullable(),
});

export const updateProductSchema = createProductSchema.partial();

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
  categoryId: z.string().uuid().optional(),
  categorySlug: z.string().optional(),
  brand: z.string().optional(),
  tag: z.string().optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  search: z.string().optional(),
  sort: z.enum(['price-asc', 'price-desc', 'rating', 'newest']).default('newest'),
});

export const productIdParamSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID'),
});

export const productIdOrSlugParamSchema = z.object({
  idOrSlug: z.string().min(1, 'ID or slug is required'),
});

export const deleteImageParamSchema = z.object({
  id: z.string().uuid('Product ID must be a valid UUID'),
  imageKey: z.string().min(1, 'Image key is required'),
});
