import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UserAuth, type IUserAuth } from '../models/UserAuth.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { Session } from '../models/Session.js';
import * as tokenService from './tokenService.js';
import * as emailService from './emailService.js';
import { publishEvent } from '../config/kafka.js';
import { getRedisClient } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type {
  TokenPair,
  DeviceInfo,
  UserRole,
  KafkaEvent,
  UserRegisteredPayload,
} from '@shopos/shared-types';

const BCRYPT_ROUNDS = env.BCRYPT_ROUNDS;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;  // 15 minutes

// Two browser tabs refreshing at the same moment is normal. Reuse of an
// already-rotated refresh token is only treated as theft after this window.
const REFRESH_REUSE_GRACE_MS = 10_000;

// Hash used to equalise login timing for unknown emails, so response time
// does not reveal whether an account exists. Computed lazily (bcrypt is slow).
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = bcrypt.hash('shopos-timing-equaliser', BCRYPT_ROUNDS);
  return dummyHash;
}

// ─── Register ───────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResult {
  user: {
    id: string;
    email: string;
    roles: UserRole[];
    isEmailVerified: boolean;
    createdAt: Date;
  };
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const email = input.email.toLowerCase();

  // Cheap pre-check; the unique index below is the real guard against races.
  const existingUser = await UserAuth.exists({ email });
  if (existingUser) {
    throw new AppError('An account with this email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // Only a hash of the token is stored; the raw token goes out by email.
  const emailVerifyToken = tokenService.generateSecureToken();
  const emailVerifyExpiry = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

  let user: IUserAuth;
  try {
    user = await UserAuth.create({
      email,
      passwordHash,
      roles: ['customer'] as UserRole[],
      permissions: [],
      isEmailVerified: false,
      emailVerifyToken: tokenService.hashSecureToken(emailVerifyToken),
      emailVerifyExpiry,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError('An account with this email already exists', 409);
    }
    throw err;
  }

  // Send verification email (fire and forget — never block the request on SMTP)
  emailService.sendVerificationEmail(user.email, emailVerifyToken).catch((err) => {
    logger.error('Failed to send verification email', {
      userId: user._id.toString(),
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  const event: KafkaEvent<UserRegisteredPayload & { name: string }> = {
    eventId: uuidv4(),
    type: 'user.registered',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      userId: user._id.toString(),
      email: user.email,
      name: input.name,
      roles: user.roles as UserRole[],
      registeredAt: user.createdAt.toISOString(),
    },
  };
  publishEvent('user.registered', event, user._id.toString()).catch(() => undefined);

  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles as UserRole[],
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
    },
  };
}

// ─── Login ──────────────────────────────────────────────────────────

export interface LoginInput {
  email: string;
  password: string;
  deviceInfo: DeviceInfo;
}

export interface LoginResult {
  tokens: TokenPair;
  user: {
    id: string;
    email: string;
    roles: UserRole[];
    isEmailVerified: boolean;
  };
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const { password, deviceInfo } = input;
  const email = input.email.toLowerCase();

  const user = await UserAuth.findOne({ email }).select('+passwordHash');
  if (!user) {
    await bcrypt.compare(password, await getDummyHash());
    throw new AppError('Invalid email or password', 401);
  }

  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    const remainingMin = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 60000);
    throw new AppError(`Account is locked. Try again in ${remainingMin} minute(s)`, 423);
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    // A lockout that has already expired starts a fresh count; otherwise one
    // more typo after the 30 minutes would immediately re-lock the account.
    const lockoutExpired = !!user.lockoutUntil && user.lockoutUntil <= new Date();
    // Atomic update — concurrent bad attempts must all be counted.
    const updated = await UserAuth.findOneAndUpdate(
      { _id: user._id },
      lockoutExpired
        ? { $set: { failedLoginAttempts: 1, lockoutUntil: null } }
        : { $inc: { failedLoginAttempts: 1 } },
      { new: true, projection: { failedLoginAttempts: 1 } },
    );
    if ((updated?.failedLoginAttempts ?? 0) >= MAX_FAILED_ATTEMPTS) {
      await UserAuth.updateOne(
        { _id: user._id },
        { $set: { lockoutUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } },
      );
      logger.warn('Account locked due to too many failed login attempts', {
        userId: user._id.toString(),
      });
    }
    throw new AppError('Invalid email or password', 401);
  }

  if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
    await UserAuth.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lockoutUntil: null } },
    );
  }

  const [tokens] = await Promise.all([
    generateTokenPair(user, deviceInfo),
    Session.findOneAndUpdate(
      { userId: user._id, deviceName: deviceInfo.ua.substring(0, 100) },
      {
        userId: user._id,
        deviceName: deviceInfo.ua.substring(0, 100),
        ip: deviceInfo.ip,
        lastActiveAt: new Date(),
      },
      { upsert: true, new: true },
    ),
  ]);

  return {
    tokens,
    user: {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles as UserRole[],
      isEmailVerified: user.isEmailVerified,
    },
  };
}

// ─── Logout ─────────────────────────────────────────────────────────

export async function logout(accessToken: string, refreshTokenRaw: string): Promise<void> {
  const redis = getRedisClient();

  // Blacklist the access token in Redis until it would have expired anyway
  const decoded = tokenService.decodeToken(accessToken);
  if (decoded?.exp) {
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redis.set(tokenService.blacklistKey(accessToken, decoded.jti), '1', 'EX', ttl);
    }
  }

  if (refreshTokenRaw) {
    const hash = tokenService.hashRefreshToken(refreshTokenRaw);
    await RefreshToken.updateOne({ tokenHash: hash }, { $set: { revokedAt: new Date() } });
  }
}

// ─── Refresh Tokens ─────────────────────────────────────────────────

export interface RefreshResult {
  tokens: TokenPair;
}

export async function refreshTokens(
  oldRefreshTokenRaw: string,
  deviceInfo: DeviceInfo,
): Promise<RefreshResult> {
  const oldHash = tokenService.hashRefreshToken(oldRefreshTokenRaw);
  const now = new Date();

  // Atomically claim the token: exactly ONE concurrent request can rotate it.
  // (The previous find-then-save let two parallel refreshes both succeed.)
  const storedToken = await RefreshToken.findOneAndUpdate(
    { tokenHash: oldHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
    { new: false },
  );

  if (!storedToken) {
    const existing = await RefreshToken.findOne({ tokenHash: oldHash }).lean();
    if (!existing) {
      throw new AppError('Invalid refresh token', 401);
    }
    if (existing.revokedAt) {
      const sinceRevokeMs = now.getTime() - new Date(existing.revokedAt).getTime();
      if (sinceRevokeMs <= REFRESH_REUSE_GRACE_MS) {
        // Benign race (two tabs). Client should retry with the newest token.
        throw new AppError('Refresh token already rotated', 409);
      }
      logger.warn('Refresh token reuse detected — revoking entire family', {
        family: existing.family,
        userId: existing.userId.toString(),
      });
      await RefreshToken.updateMany(
        { family: existing.family, revokedAt: null },
        { $set: { revokedAt: now } },
      );
      throw new AppError('Token reuse detected. All sessions revoked for security.', 403);
    }
    throw new AppError('Refresh token has expired', 401);
  }

  const user = await UserAuth.findById(storedToken.userId);
  if (!user) {
    throw new AppError('User not found', 401);
  }

  const newRefreshTokenRaw = tokenService.generateRefreshToken();

  await RefreshToken.create({
    userId: user._id,
    tokenHash: tokenService.hashRefreshToken(newRefreshTokenRaw),
    family: storedToken.family, // same family for rotation tracking
    deviceInfo: {
      ua: deviceInfo.ua,
      ip: deviceInfo.ip,
      fingerprint: deviceInfo.fingerprint,
    },
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TOKEN_TTL * 1000),
  });

  const accessToken = tokenService.signAccessToken({
    sub: user._id.toString(),
    email: user.email,
    roles: user.roles as UserRole[],
    permissions: user.permissions,
  });

  return {
    tokens: {
      accessToken,
      refreshToken: newRefreshTokenRaw,
      expiresIn: env.JWT_ACCESS_TOKEN_TTL,
    },
  };
}

// ─── Email Verification ─────────────────────────────────────────────

export async function verifyEmail(token: string): Promise<void> {
  const user = await UserAuth.findOneAndUpdate(
    {
      emailVerifyToken: tokenService.hashSecureToken(token),
      emailVerifyExpiry: { $gt: new Date() },
    },
    { $set: { isEmailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null } },
    { new: true },
  );

  if (!user) {
    throw new AppError('Invalid or expired verification token', 400);
  }

  logger.info('Email verified successfully', { userId: user._id.toString() });
}

// ─── Forgot Password ───────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  // Always return success to prevent email enumeration
  const user = await UserAuth.findOne({ email: email.toLowerCase() });

  if (user) {
    const resetToken = tokenService.generateSecureToken();
    user.resetPasswordToken = tokenService.hashSecureToken(resetToken);
    user.resetPasswordExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    emailService.sendPasswordResetEmail(user.email, resetToken).catch((err) => {
      logger.error('Failed to send password reset email', {
        userId: user._id.toString(),
        error: err instanceof Error ? err.message : 'Unknown',
      });
    });
  }
}

// ─── Reset Password ────────────────────────────────────────────────

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const user = await UserAuth.findOne({
    resetPasswordToken: tokenService.hashSecureToken(token),
    resetPasswordExpiry: { $gt: new Date() },
  });

  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.resetPasswordToken = null;
  user.resetPasswordExpiry = null;
  user.failedLoginAttempts = 0;
  user.lockoutUntil = null;
  await user.save();

  // Force re-login on all devices
  await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  logger.info('Password reset successfully', { userId: user._id.toString() });
}

// ─── Helper: Generate Token Pair ────────────────────────────────────

async function generateTokenPair(user: IUserAuth, deviceInfo: DeviceInfo): Promise<TokenPair> {
  const accessToken = tokenService.signAccessToken({
    sub: user._id.toString(),
    email: user.email,
    roles: user.roles as UserRole[],
    permissions: user.permissions,
  });

  const refreshTokenRaw = tokenService.generateRefreshToken();

  await RefreshToken.create({
    userId: user._id,
    tokenHash: tokenService.hashRefreshToken(refreshTokenRaw),
    family: uuidv4(), // New family for each login
    deviceInfo: {
      ua: deviceInfo.ua,
      ip: deviceInfo.ip,
      fingerprint: deviceInfo.fingerprint,
    },
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TOKEN_TTL * 1000),
  });

  return {
    accessToken,
    refreshToken: refreshTokenRaw,
    expiresIn: env.JWT_ACCESS_TOKEN_TTL,
  };
}

// ─── Custom Error Class ─────────────────────────────────────────────

export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}
