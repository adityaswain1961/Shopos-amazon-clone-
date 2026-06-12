import { Session } from '../models/Session.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { logger } from '../utils/logger.js';
import { AppError } from './authService.js';

/**
 * List all active sessions for a user.
 */
export async function listSessions(userId: string) {
  return Session.find({ userId })
    .sort({ lastActiveAt: -1 })
    .lean()
    .exec();
}

/**
 * Revoke a specific session and its associated refresh tokens.
 */
export async function revokeSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  // Revoke all refresh tokens associated with this session's device
  await RefreshToken.updateMany(
    {
      userId,
      'deviceInfo.ua': session.deviceName,
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
  );

  await Session.deleteOne({ _id: sessionId });

  logger.info('Session revoked', { sessionId, userId });
}

/**
 * Revoke all sessions for a user (logout everywhere).
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  // Revoke all refresh tokens
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  // Delete all sessions
  await Session.deleteMany({ userId });

  logger.info('All sessions revoked', { userId });
}
