import type { Request, Response, NextFunction } from 'express';
import * as profileService from '../services/profileService.js';
import * as avatarService from '../services/avatarService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import archiver from 'archiver';

// ─── Get Profile ────────────────────────────────────────────────────

export async function getProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const profile = await profileService.getProfile(req.user.sub);
    sendSuccess(res, { profile });
  } catch (error) {
    next(error);
  }
}

// ─── Update Profile ─────────────────────────────────────────────────

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const profile = await profileService.updateProfile(req.user.sub, req.body);
    sendSuccess(res, { profile });
  } catch (error) {
    next(error);
  }
}

// ─── Upload Avatar ──────────────────────────────────────────────────

export async function uploadAvatar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    if (!req.file) {
      sendError(res, 'No avatar file provided', 400);
      return;
    }

    const avatarUrl = await avatarService.processAndUploadAvatar(
      req.user.sub,
      req.file.buffer,
    );

    sendSuccess(res, { avatarUrl });
  } catch (error) {
    next(error);
  }
}

// ─── Delete Account (GDPR) ─────────────────────────────────────────

export async function deleteAccount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    await profileService.deleteAccount(req.user.sub);
    sendSuccess(res, { message: 'Account scheduled for deletion' });
  } catch (error) {
    next(error);
  }
}

// ─── Export Data (GDPR) ─────────────────────────────────────────────

export async function exportData(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const data = await profileService.exportUserData(req.user.sub);

    // Stream as ZIP
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="shopos-data-export-${req.user.sub}.zip"`,
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Add each data section as a JSON file
    archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(data.addresses, null, 2), { name: 'addresses.json' });
    archive.append(JSON.stringify(data.wishlists, null, 2), { name: 'wishlists.json' });
    archive.append(JSON.stringify(data.recentlyViewed, null, 2), { name: 'recently-viewed.json' });
    archive.append(JSON.stringify(data.searchHistory, null, 2), { name: 'search-history.json' });
    archive.append(JSON.stringify({ exportedAt: data.exportedAt }, null, 2), { name: 'metadata.json' });

    await archive.finalize();
  } catch (error) {
    next(error);
  }
}
