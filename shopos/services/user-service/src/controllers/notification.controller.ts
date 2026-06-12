import type { Request, Response, NextFunction } from 'express';
import { UserProfile } from '../models/UserProfile.js';
import { invalidateProfileCache } from '../services/profileService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';

// ─── Get Notification Preferences ───────────────────────────────────

export async function getPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const profile = await UserProfile.findOne({
      userId: req.user.sub,
      isDeleted: false,
    }).select('notificationPrefs');

    if (!profile) {
      sendError(res, 'Profile not found', 404);
      return;
    }

    sendSuccess(res, { preferences: profile.notificationPrefs });
  } catch (error) {
    next(error);
  }
}

// ─── Update Notification Preferences ────────────────────────────────

export async function updatePreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const profile = await UserProfile.findOne({
      userId: req.user.sub,
      isDeleted: false,
    });

    if (!profile) {
      sendError(res, 'Profile not found', 404);
      return;
    }

    // Apply partial updates to notification preferences
    const { email, sms, push, promotions } = req.body;
    if (email !== undefined) profile.notificationPrefs.email = email;
    if (sms !== undefined) profile.notificationPrefs.sms = sms;
    if (push !== undefined) profile.notificationPrefs.push = push;
    if (promotions !== undefined) profile.notificationPrefs.promotions = promotions;

    await profile.save();
    await invalidateProfileCache(req.user.sub);

    sendSuccess(res, { preferences: profile.notificationPrefs });
  } catch (error) {
    next(error);
  }
}
