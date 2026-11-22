import { Wishlist } from '../models/Wishlist.js';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import type { CreateWishlistInput, UpdateWishlistInput } from '../validators/user.validators.js';

const MAX_WISHLIST_ITEMS = 500;

// ─── List Wishlists ─────────────────────────────────────────────────

export async function listWishlists(userId: string) {
  return Wishlist.find({ userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
}

// ─── Create Wishlist ────────────────────────────────────────────────

export async function createWishlist(userId: string, data: CreateWishlistInput) {
  const wishlist = await Wishlist.create({
    userId,
    name: data.name,
    isPublic: data.isPublic,
  });

  logger.info('Wishlist created', { userId, wishlistId: wishlist._id.toString() });
  return wishlist;
}

// ─── Update Wishlist ────────────────────────────────────────────────

export async function updateWishlist(
  userId: string,
  wishlistId: string,
  data: UpdateWishlistInput,
) {
  const wishlist = await Wishlist.findOneAndUpdate(
    { _id: wishlistId, userId },
    { $set: data },
    { new: true, runValidators: true },
  );

  if (!wishlist) {
    throw new AppError('Wishlist not found', 404);
  }

  logger.info('Wishlist updated', { userId, wishlistId });
  return wishlist;
}

// ─── Delete Wishlist ────────────────────────────────────────────────

export async function deleteWishlist(userId: string, wishlistId: string): Promise<void> {
  const result = await Wishlist.findOneAndDelete({ _id: wishlistId, userId });

  if (!result) {
    throw new AppError('Wishlist not found', 404);
  }

  logger.info('Wishlist deleted', { userId, wishlistId });
}

// ─── Add Item ───────────────────────────────────────────────────────

export async function addItem(
  userId: string,
  wishlistId: string,
  productId: string,
  variantId?: string,
) {
  const wishlist = await Wishlist.findOne({ _id: wishlistId, userId });
  if (!wishlist) {
    throw new AppError('Wishlist not found', 404);
  }

  // Bound document size: unbounded arrays make every read/write slower.
  if (wishlist.items.length >= MAX_WISHLIST_ITEMS) {
    throw new AppError(`A wishlist can hold at most ${MAX_WISHLIST_ITEMS} items`, 400);
  }

  // Prevent duplicate products
  const exists = wishlist.items.some((item) => item.productId === productId);
  if (exists) {
    throw new AppError('Product already in wishlist', 409);
  }

  wishlist.items.push({
    productId,
    variantId,
    addedAt: new Date(),
  });

  await wishlist.save();

  logger.info('Item added to wishlist', { userId, wishlistId, productId });
  return wishlist;
}

// ─── Remove Item ────────────────────────────────────────────────────

export async function removeItem(
  userId: string,
  wishlistId: string,
  productId: string,
) {
  const wishlist = await Wishlist.findOne({ _id: wishlistId, userId });
  if (!wishlist) {
    throw new AppError('Wishlist not found', 404);
  }

  const initialLength = wishlist.items.length;
  wishlist.items = wishlist.items.filter((item) => item.productId !== productId);

  if (wishlist.items.length === initialLength) {
    throw new AppError('Product not found in wishlist', 404);
  }

  await wishlist.save();

  logger.info('Item removed from wishlist', { userId, wishlistId, productId });
  return wishlist;
}

// ─── Get Shared Wishlist (Public, No Auth) ──────────────────────────

export async function getSharedWishlist(shareToken: string) {
  const wishlist = await Wishlist.findOne({
    shareToken,
    isPublic: true,
  }).lean().exec();

  if (!wishlist) {
    throw new AppError('Wishlist not found or is private', 404);
  }

  return wishlist;
}
