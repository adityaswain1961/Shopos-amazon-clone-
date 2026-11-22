import { Router } from 'express';
import * as profileController from '../controllers/profile.controller.js';
import * as addressController from '../controllers/address.controller.js';
import * as wishlistController from '../controllers/wishlist.controller.js';
import * as historyController from '../controllers/history.controller.js';
import * as notificationController from '../controllers/notification.controller.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { handleAvatarUpload } from '../middleware/upload.js';
import {
  updateProfileSchema,
  createAddressSchema,
  updateAddressSchema,
  addressIdParamSchema,
  setDefaultSchema,
  createWishlistSchema,
  updateWishlistSchema,
  wishlistIdParamSchema,
  wishlistItemParamSchema,
  shareTokenParamSchema,
  notificationPrefsSchema,
} from '../validators/user.validators.js';

const router = Router();

// ─── Profile Routes (auth required) ────────────────────────────────

router.get(
  '/me',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:user:me' }),
  profileController.getProfile,
);

router.patch(
  '/me',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:user:update' }),
  validateRequest({ body: updateProfileSchema }),
  profileController.updateProfile,
);

router.post(
  '/me/avatar',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:user:avatar' }),
  handleAvatarUpload,
  profileController.uploadAvatar,
);

router.delete(
  '/me',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'rl:user:delete' }),
  profileController.deleteAccount,
);

router.get(
  '/me/export',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:user:export' }),
  profileController.exportData,
);

// ─── Address Routes (auth required) ────────────────────────────────

router.get(
  '/me/addresses',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:addr:list' }),
  addressController.listAddresses,
);

router.post(
  '/me/addresses',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:addr:create' }),
  validateRequest({ body: createAddressSchema }),
  addressController.createAddress,
);

router.patch(
  '/me/addresses/:id',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:addr:update' }),
  validateRequest({ params: addressIdParamSchema, body: updateAddressSchema }),
  addressController.updateAddress,
);

router.delete(
  '/me/addresses/:id',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:addr:delete' }),
  validateRequest({ params: addressIdParamSchema }),
  addressController.deleteAddress,
);

router.patch(
  '/me/addresses/:id/default',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:addr:default' }),
  validateRequest({ params: addressIdParamSchema, body: setDefaultSchema }),
  addressController.setDefault,
);

// ─── Wishlist Routes (auth required, except share) ──────────────────

router.get(
  '/me/wishlists',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:wish:list' }),
  wishlistController.listWishlists,
);

router.post(
  '/me/wishlists',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:wish:create' }),
  validateRequest({ body: createWishlistSchema }),
  wishlistController.createWishlist,
);

router.patch(
  '/me/wishlists/:id',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:wish:update' }),
  validateRequest({ params: wishlistIdParamSchema, body: updateWishlistSchema }),
  wishlistController.updateWishlist,
);

router.delete(
  '/me/wishlists/:id',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:wish:delete' }),
  validateRequest({ params: wishlistIdParamSchema }),
  wishlistController.deleteWishlist,
);

router.post(
  '/me/wishlists/:id/items/:productId',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'rl:wish:add' }),
  validateRequest({ params: wishlistItemParamSchema }),
  wishlistController.addItem,
);

router.delete(
  '/me/wishlists/:id/items/:productId',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'rl:wish:remove' }),
  validateRequest({ params: wishlistItemParamSchema }),
  wishlistController.removeItem,
);

// Public: shared wishlist (no auth)
router.get(
  '/wishlists/share/:token',
  rateLimiter({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'rl:wish:share' }),
  validateRequest({ params: shareTokenParamSchema }),
  wishlistController.getShared,
);

// ─── History Routes (auth required) ────────────────────────────────

router.get(
  '/me/recently-viewed',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:rv:list' }),
  historyController.getRecentlyViewed,
);

router.delete(
  '/me/recently-viewed',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:rv:clear' }),
  historyController.clearRecentlyViewed,
);

router.get(
  '/me/search-history',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:sh:list' }),
  historyController.getSearchHistory,
);

router.delete(
  '/me/search-history',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:sh:clear' }),
  historyController.clearSearchHistory,
);

// ─── Notification Preferences Routes (auth required) ────────────────

router.get(
  '/me/notification-prefs',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:notif:get' }),
  notificationController.getPreferences,
);

router.patch(
  '/me/notification-prefs',
  authMiddleware,
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:notif:update' }),
  validateRequest({ body: notificationPrefsSchema }),
  notificationController.updatePreferences,
);

export default router;
