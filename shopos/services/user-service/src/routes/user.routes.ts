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
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:user:me' }),
  authMiddleware,
  profileController.getProfile,
);

router.patch(
  '/me',
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:user:update' }),
  authMiddleware,
  validateRequest({ body: updateProfileSchema }),
  profileController.updateProfile,
);

router.post(
  '/me/avatar',
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:user:avatar' }),
  authMiddleware,
  handleAvatarUpload,
  profileController.uploadAvatar,
);

router.delete(
  '/me',
  rateLimiter({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'rl:user:delete' }),
  authMiddleware,
  profileController.deleteAccount,
);

router.get(
  '/me/export',
  rateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:user:export' }),
  authMiddleware,
  profileController.exportData,
);

// ─── Address Routes (auth required) ────────────────────────────────

router.get(
  '/me/addresses',
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:addr:list' }),
  authMiddleware,
  addressController.listAddresses,
);

router.post(
  '/me/addresses',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:addr:create' }),
  authMiddleware,
  validateRequest({ body: createAddressSchema }),
  addressController.createAddress,
);

router.patch(
  '/me/addresses/:id',
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:addr:update' }),
  authMiddleware,
  validateRequest({ params: addressIdParamSchema, body: updateAddressSchema }),
  addressController.updateAddress,
);

router.delete(
  '/me/addresses/:id',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:addr:delete' }),
  authMiddleware,
  validateRequest({ params: addressIdParamSchema }),
  addressController.deleteAddress,
);

router.patch(
  '/me/addresses/:id/default',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:addr:default' }),
  authMiddleware,
  validateRequest({ params: addressIdParamSchema, body: setDefaultSchema }),
  addressController.setDefault,
);

// ─── Wishlist Routes (auth required, except share) ──────────────────

router.get(
  '/me/wishlists',
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:wish:list' }),
  authMiddleware,
  wishlistController.listWishlists,
);

router.post(
  '/me/wishlists',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:wish:create' }),
  authMiddleware,
  validateRequest({ body: createWishlistSchema }),
  wishlistController.createWishlist,
);

router.patch(
  '/me/wishlists/:id',
  rateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:wish:update' }),
  authMiddleware,
  validateRequest({ params: wishlistIdParamSchema, body: updateWishlistSchema }),
  wishlistController.updateWishlist,
);

router.delete(
  '/me/wishlists/:id',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:wish:delete' }),
  authMiddleware,
  validateRequest({ params: wishlistIdParamSchema }),
  wishlistController.deleteWishlist,
);

router.post(
  '/me/wishlists/:id/items/:productId',
  rateLimiter({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'rl:wish:add' }),
  authMiddleware,
  validateRequest({ params: wishlistItemParamSchema }),
  wishlistController.addItem,
);

router.delete(
  '/me/wishlists/:id/items/:productId',
  rateLimiter({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'rl:wish:remove' }),
  authMiddleware,
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
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:rv:list' }),
  authMiddleware,
  historyController.getRecentlyViewed,
);

router.delete(
  '/me/recently-viewed',
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:rv:clear' }),
  authMiddleware,
  historyController.clearRecentlyViewed,
);

router.get(
  '/me/search-history',
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:sh:list' }),
  authMiddleware,
  historyController.getSearchHistory,
);

router.delete(
  '/me/search-history',
  rateLimiter({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:sh:clear' }),
  authMiddleware,
  historyController.clearSearchHistory,
);

// ─── Notification Preferences Routes (auth required) ────────────────

router.get(
  '/me/notification-prefs',
  rateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:notif:get' }),
  authMiddleware,
  notificationController.getPreferences,
);

router.patch(
  '/me/notification-prefs',
  rateLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:notif:update' }),
  authMiddleware,
  validateRequest({ body: notificationPrefsSchema }),
  notificationController.updatePreferences,
);

export default router;
