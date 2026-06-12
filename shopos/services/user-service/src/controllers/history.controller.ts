import type { Request, Response, NextFunction } from 'express';
import * as historyService from '../services/historyService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';

// ─── Get Recently Viewed ────────────────────────────────────────────

export async function getRecentlyViewed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 50);
    const items = await historyService.getRecentlyViewed(req.user.sub, limit);
    sendSuccess(res, { items });
  } catch (error) {
    next(error);
  }
}

// ─── Clear Recently Viewed ──────────────────────────────────────────

export async function clearRecentlyViewed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    await historyService.clearRecentlyViewed(req.user.sub);
    sendSuccess(res, { message: 'Recently viewed history cleared' });
  } catch (error) {
    next(error);
  }
}

// ─── Get Search History ─────────────────────────────────────────────

export async function getSearchHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 100);
    const items = await historyService.getSearchHistory(req.user.sub, limit);
    sendSuccess(res, { items });
  } catch (error) {
    next(error);
  }
}

// ─── Clear Search History ───────────────────────────────────────────

export async function clearSearchHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    await historyService.clearSearchHistory(req.user.sub);
    sendSuccess(res, { message: 'Search history cleared' });
  } catch (error) {
    next(error);
  }
}
