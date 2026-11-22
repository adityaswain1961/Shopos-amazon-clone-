import { z } from 'zod';

// Matches prisma/schema.prisma (model Product). Every writable field is listed
// explicitly — request bodies are never passed to Prisma as-is.

export const PRODUCT_STATUSES = ['draft', 'published', 'archived', 'out_of_stock'] as const;

const money = z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01);

const variantInput = z.object({
  sku: z.string().trim().min(3).max(100),
  barcode: z.string().trim().max(100).optional(),
  price: money.optional(),
  attributes: z.record(z.string().max(100)).optional(),
});

const imageInput = z.object({
  url: z.string().url().max(2048),
  altText: z.string().max(200).optional(),
  isPrimary: z.boolean().optional(),
  position: z.number().int().min(0).max(100).optional(),
});

export const createProductSchema = z.object({
  title: z.string().trim().min(2).max(300),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(350)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase letters, digits and dashes')
    .optional(),
  description: z.string().max(20_000).optional(),
  highlights: z.array(z.string().max(300)).max(20).default([]),
  specs: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  status: z.enum(PRODUCT_STATUSES).default('draft'),
  basePrice: money,
  comparePrice: money.optional().nullable(),
  costPrice: money.optional().nullable(),
  taxClass: z.string().max(50).optional(),
  currency: z.string().length(3).toUpperCase().default('INR'),
  tags: z.array(z.string().trim().toLowerCase().max(50)).max(30).default([]),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  variants: z.array(variantInput).max(100).default([]),
  images: z.array(imageInput).max(15).default([]),
  // Only admins may set these; silently ignored for sellers in the controller.
  isFeatured: z.boolean().optional(),
  isSponsored: z.boolean().optional(),
});

export const updateProductSchema = createProductSchema
  .omit({ variants: true, images: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc'] as const;

export const productListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(24),
  cursor: z.string().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  categorySlug: z.string().max(150).optional(),
  tag: z.string().max(50).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
  // Seller dashboard: list my own products in any status (requires auth)
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
