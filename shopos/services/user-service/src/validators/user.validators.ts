import { z } from 'zod';

// ─── Profile ────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Display name must be at least 2 characters')
    .max(100, 'Display name must be at most 100 characters')
    .trim()
    .optional(),
  bio: z
    .string()
    .max(500, 'Bio must be at most 500 characters')
    .optional(),
  phone: z
    .string()
    .max(20, 'Phone number is too long')
    .trim()
    .optional(),
  dateOfBirth: z
    .string()
    .datetime({ message: 'Invalid date format. Use ISO 8601.' })
    .optional(),
  language: z
    .string()
    .min(2)
    .max(10)
    .optional(),
  currency: z
    .string()
    .length(3, 'Currency must be a 3-letter code')
    .optional(),
  profilePublic: z
    .boolean()
    .optional(),
}).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ─── Addresses ──────────────────────────────────────────────────────

export const createAddressSchema = z.object({
  label: z.enum(['home', 'work', 'other']).default('home'),
  fullName: z.string().min(1, 'Full name is required').max(200).trim(),
  phone: z.string().min(1, 'Phone is required').max(20).trim(),
  line1: z.string().min(1, 'Address line 1 is required').max(300).trim(),
  line2: z.string().max(300).trim().optional().default(''),
  city: z.string().min(1, 'City is required').trim(),
  state: z.string().min(1, 'State is required').trim(),
  country: z.string().min(1, 'Country is required').trim(),
  postalCode: z.string().min(1, 'Postal code is required').trim(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).strict();

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = createAddressSchema.partial().strict();
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const addressIdParamSchema = z.object({
  id: z.string().min(1, 'Address ID is required'),
});

export const setDefaultSchema = z.object({
  type: z.enum(['shipping', 'billing'], {
    required_error: 'Type must be "shipping" or "billing"',
  }),
}).strict();

export type SetDefaultInput = z.infer<typeof setDefaultSchema>;

// ─── Wishlists ──────────────────────────────────────────────────────

export const createWishlistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).trim(),
  isPublic: z.boolean().optional().default(false),
}).strict();

export type CreateWishlistInput = z.infer<typeof createWishlistSchema>;

export const updateWishlistSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  isPublic: z.boolean().optional(),
}).strict();

export type UpdateWishlistInput = z.infer<typeof updateWishlistSchema>;

export const wishlistIdParamSchema = z.object({
  id: z.string().min(1, 'Wishlist ID is required'),
});

export const wishlistItemParamSchema = z.object({
  id: z.string().min(1, 'Wishlist ID is required'),
  productId: z.string().min(1, 'Product ID is required'),
});

export const addWishlistItemBodySchema = z.object({
  variantId: z.string().optional(),
}).strict().optional();

export const shareTokenParamSchema = z.object({
  token: z.string().min(1, 'Share token is required'),
});

// ─── Notification Preferences ───────────────────────────────────────

export const notificationPrefsSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  push: z.boolean().optional(),
  promotions: z.boolean().optional(),
}).strict();

export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;
