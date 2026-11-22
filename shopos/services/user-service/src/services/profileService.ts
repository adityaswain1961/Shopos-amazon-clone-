import { v4 as uuidv4 } from 'uuid';
import { UserProfile, type IUserProfile } from '../models/UserProfile.js';
import { Address } from '../models/Address.js';
import { Wishlist } from '../models/Wishlist.js';
import { RecentlyViewed } from '../models/RecentlyViewed.js';
import { SearchHistory } from '../models/SearchHistory.js';
import { getRedisClient } from '../config/redis.js';
import { publishEvent } from '../config/kafka.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/appError.js';
import type { KafkaEvent, UserProfileUpdatedPayload } from '@shopos/shared-types';
import type { UpdateProfileInput } from '../validators/user.validators.js';

const PROFILE_CACHE_TTL = 600; // 10 minutes in seconds
const PROFILE_CACHE_PREFIX = 'user:profile:';

// ─── Profile Completion Calculation ─────────────────────────────────

function calculateCompletion(profile: IUserProfile): number {
  const fields = [
    { filled: !!profile.displayName, weight: 20 },
    { filled: !!profile.bio, weight: 10 },
    { filled: !!profile.phone, weight: 15 },
    { filled: !!profile.dateOfBirth, weight: 10 },
    { filled: !!profile.avatarUrl, weight: 20 },
    { filled: !!profile.language && profile.language !== 'en', weight: 5 },
    { filled: !!profile.currency, weight: 5 },
    // Check if notification prefs have been explicitly set
    { filled: profile.notificationPrefs != null, weight: 15 },
  ];

  return fields.reduce((sum, f) => sum + (f.filled ? f.weight : 0), 0);
}

// ─── Get Profile ────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<IUserProfile> {
  const redis = getRedisClient();
  const cacheKey = `${PROFILE_CACHE_PREFIX}${userId}`;

  // Try Redis cache first
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug('Profile cache hit', { userId });
      return JSON.parse(cached) as IUserProfile;
    }
  } catch {
    // Redis down — continue to MongoDB
  }

  // Find or create profile
  let profile = await UserProfile.findOne({ userId, isDeleted: false });

  if (!profile) {
    // Auto-create profile on first access (user registered via auth-service).
    // The frontend often fires several requests at once after login, so two
    // creates can race — the unique index on userId decides, loser re-reads.
    try {
      profile = await UserProfile.create({ userId });
      logger.info('Auto-created user profile', { userId });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      profile = await UserProfile.findOne({ userId, isDeleted: false });
      if (!profile) throw new AppError('Profile not found', 404);
    }
  }

  // Update completion percentage
  const completion = calculateCompletion(profile);
  if (profile.completionPercent !== completion) {
    profile.completionPercent = completion;
    await profile.save();
  }

  // Cache in Redis
  try {
    await redis.set(cacheKey, JSON.stringify(profile.toJSON()), 'EX', PROFILE_CACHE_TTL);
  } catch {
    // Non-fatal
  }

  return profile;
}

// ─── Update Profile ─────────────────────────────────────────────────

export async function updateProfile(
  userId: string,
  data: UpdateProfileInput,
): Promise<IUserProfile> {
  const profile = await UserProfile.findOne({ userId, isDeleted: false });
  if (!profile) {
    throw new AppError('Profile not found', 404);
  }

  // Apply updates
  if (data.displayName !== undefined) profile.displayName = data.displayName;
  if (data.bio !== undefined) profile.bio = data.bio;
  if (data.phone !== undefined) profile.phone = data.phone;
  if (data.dateOfBirth !== undefined) profile.dateOfBirth = new Date(data.dateOfBirth);
  if (data.language !== undefined) profile.language = data.language;
  if (data.currency !== undefined) profile.currency = data.currency;
  if (data.profilePublic !== undefined) profile.profilePublic = data.profilePublic;

  // Recalculate completion
  profile.completionPercent = calculateCompletion(profile);

  await profile.save();

  // Invalidate Redis cache
  await invalidateProfileCache(userId);

  // Publish Kafka event
  const event: KafkaEvent<UserProfileUpdatedPayload> = {
    eventId: uuidv4(),
    type: 'user.profile_updated',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      userId,
      updatedFields: Object.keys(data),
      updatedAt: new Date().toISOString(),
    },
  };
  publishEvent('user.profile_updated', event).catch((err) => {
    logger.error('Failed to publish user.profile_updated event', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  return profile;
}

// ─── Delete Account (GDPR) ──────────────────────────────────────────

export async function deleteAccount(userId: string): Promise<void> {
  const profile = await UserProfile.findOne({ userId, isDeleted: false });
  if (!profile) {
    throw new AppError('Profile not found', 404);
  }

  // Soft delete
  profile.isDeleted = true;
  profile.deletedAt = new Date();
  profile.displayName = '[Deleted User]';
  profile.bio = '';
  profile.phone = '';
  profile.dateOfBirth = null;
  profile.avatarUrl = '';
  await profile.save();

  // Invalidate cache
  await invalidateProfileCache(userId);

  // Publish deletion event for downstream cleanup
  const event: KafkaEvent<{ userId: string; deletedAt: string }> = {
    eventId: uuidv4(),
    type: 'user.account_deleted',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      userId,
      deletedAt: new Date().toISOString(),
    },
  };
  publishEvent('user.account_deleted', event).catch((err) => {
    logger.error('Failed to publish user.account_deleted event', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  logger.info('Account soft-deleted (GDPR)', { userId });
}

// ─── Export User Data (GDPR) ────────────────────────────────────────

export interface UserDataExport {
  profile: object;
  addresses: object[];
  wishlists: object[];
  recentlyViewed: object[];
  searchHistory: object[];
  exportedAt: string;
}

export async function exportUserData(userId: string): Promise<UserDataExport> {
  const [profile, addresses, wishlists, recentlyViewed, searchHistory] = await Promise.all([
    UserProfile.findOne({ userId }).lean().exec(),
    Address.find({ userId }).lean().exec(),
    Wishlist.find({ userId }).lean().exec(),
    RecentlyViewed.find({ userId }).sort({ viewedAt: -1 }).lean().exec(),
    SearchHistory.find({ userId }).sort({ searchedAt: -1 }).lean().exec(),
  ]);

  return {
    profile: profile || {},
    addresses,
    wishlists,
    recentlyViewed,
    searchHistory,
    exportedAt: new Date().toISOString(),
  };
}

// ─── Cache Invalidation ─────────────────────────────────────────────

export async function invalidateProfileCache(userId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(`${PROFILE_CACHE_PREFIX}${userId}`);
    logger.debug('Profile cache invalidated', { userId });
  } catch {
    // Non-fatal
  }
}
