import type { Request, Response, NextFunction } from 'express';
import * as wishlistService from '../services/wishlistService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';

// ─── List Wishlists ─────────────────────────────────────────────────

export async function listWishlists(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const wishlists = await wishlistService.listWishlists(req.user.sub);
    sendSuccess(res, { wishlists });
  } catch (error) {
    next(error);
  }
}

// ─── Create Wishlist ────────────────────────────────────────────────

export async function createWishlist(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const wishlist = await wishlistService.createWishlist(req.user.sub, req.body);
    sendSuccess(res, { wishlist }, 201);
  } catch (error) {
    next(error);
  }
}

// ─── Update Wishlist ────────────────────────────────────────────────

export async function updateWishlist(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const wishlistId = req.params['id'] as string;
    const wishlist = await wishlistService.updateWishlist(req.user.sub, wishlistId, req.body);
    sendSuccess(res, { wishlist });
  } catch (error) {
    next(error);
  }
}

// ─── Delete Wishlist ────────────────────────────────────────────────

export async function deleteWishlist(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const wishlistId = req.params['id'] as string;
    await wishlistService.deleteWishlist(req.user.sub, wishlistId);
    sendSuccess(res, { message: 'Wishlist deleted successfully' });
  } catch (error) {
    next(error);
  }
}

// ─── Add Item to Wishlist ───────────────────────────────────────────

export async function addItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const wishlistId = req.params['id'] as string;
    const productId = req.params['productId'] as string;
    const variantId = req.body?.variantId as string | undefined;

    const wishlist = await wishlistService.addItem(req.user.sub, wishlistId, productId, variantId);
    sendSuccess(res, { wishlist });
  } catch (error) {
    next(error);
  }
}

// ─── Remove Item from Wishlist ──────────────────────────────────────

export async function removeItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const wishlistId = req.params['id'] as string;
    const productId = req.params['productId'] as string;

    const wishlist = await wishlistService.removeItem(req.user.sub, wishlistId, productId);
    sendSuccess(res, { wishlist });
  } catch (error) {
    next(error);
  }
}

// ─── Get Shared Wishlist (Public, No Auth) ──────────────────────────

export async function getShared(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.params['token'] as string;
    const wishlist = await wishlistService.getSharedWishlist(token);
    sendSuccess(res, { wishlist });
  } catch (error) {
    next(error);
  }
}
