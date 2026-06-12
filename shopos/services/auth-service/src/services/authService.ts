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

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;  // 15 minutes

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
  const { email, password } = input;

  // Check for existing user
  const existingUser = await UserAuth.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new AppError('An account with this email already exists', 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Generate email verification token
  const emailVerifyToken = tokenService.generateSecureToken();
  const emailVerifyExpiry = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

  // Create user
  const user = await UserAuth.create({
    email: email.toLowerCase(),
    passwordHash,
    roles: ['customer'] as UserRole[],
    permissions: [],
    isEmailVerified: false,
    emailVerifyToken,
    emailVerifyExpiry,
  });

  // Send verification email (fire and forget)
  emailService.sendVerificationEmail(user.email, emailVerifyToken).catch((err) => {
    logger.error('Failed to send verification email', {
      userId: user._id.toString(),
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  // Publish Kafka event
  const event: KafkaEvent<UserRegisteredPayload> = {
    eventId: uuidv4(),
    type: 'user.registered',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles as UserRole[],
      registeredAt: user.createdAt.toISOString(),
    },
  };
  publishEvent('user.registered', event).catch((err) => {
    logger.error('Failed to publish user.registered event', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

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
  const { email, password, deviceInfo } = input;

  const user = await UserAuth.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  // Check account lockout
  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    const remainingMs = user.lockoutUntil.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    throw new AppError(
      `Account is locked. Try again in ${remainingMin} minute(s)`,
      423,
    );
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    // Increment failed attempts
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const updateData: Record<string, unknown> = { failedLoginAttempts: attempts };

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      updateData['lockoutUntil'] = new Date(Date.now() + LOCKOUT_DURATION_MS);
      logger.warn('Account locked due to too many failed login attempts', {
        userId: user._id.toString(),
        attempts,
      });
    }

    await UserAuth.updateOne({ _id: user._id }, { $set: updateData });
    throw new AppError('Invalid email or password', 401);
  }

  // Reset failed attempts on successful login
  if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
    await UserAuth.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lockoutUntil: null } },
    );
  }

  // Generate tokens
  const tokens = await generateTokenPair(user, deviceInfo);

  // Create/update session
  await Session.findOneAndUpdate(
    { userId: user._id, deviceName: deviceInfo.ua.substring(0, 100) },
    {
      userId: user._id,
      deviceName: deviceInfo.ua.substring(0, 100),
      ip: deviceInfo.ip,
      lastActiveAt: new Date(),
    },
    { upsert: true, new: true },
  );

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

export async function logout(
  accessToken: string,
  refreshTokenRaw: string,
): Promise<void> {
  const redis = getRedisClient();

  // Blacklist the access token in Redis (TTL = remaining life)
  const decoded = tokenService.decodeToken(accessToken);
  if (decoded?.exp) {
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redis.set(`blacklist:${accessToken}`, '1', 'EX', ttl);
    }
  }

  // Revoke the refresh token
  if (refreshTokenRaw) {
    const hash = tokenService.hashRefreshToken(refreshTokenRaw);
    await RefreshToken.updateOne(
      { tokenHash: hash },
      { $set: { revokedAt: new Date() } },
    );
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

  // Find the refresh token
  const storedToken = await RefreshToken.findOne({ tokenHash: oldHash });

  if (!storedToken) {
    throw new AppError('Invalid refresh token', 401);
  }

  // Check if already revoked → TOKEN THEFT DETECTED
  if (storedToken.revokedAt) {
    logger.warn('⚠️ Refresh token reuse detected — revoking entire family', {
      family: storedToken.family,
      userId: storedToken.userId.toString(),
    });

    // Revoke entire token family
    await RefreshToken.updateMany(
      { family: storedToken.family },
      { $set: { revokedAt: new Date() } },
    );

    throw new AppError('Token reuse detected. All sessions revoked for security.', 403);
  }

  // Check expiry
  if (storedToken.expiresAt < new Date()) {
    throw new AppError('Refresh token has expired', 401);
  }

  // Revoke old token
  storedToken.revokedAt = new Date();
  await storedToken.save();

  // Load user
  const user = await UserAuth.findById(storedToken.userId);
  if (!user) {
    throw new AppError('User not found', 401);
  }

  // Generate new token pair with same family
  const newRefreshTokenRaw = tokenService.generateRefreshToken();
  const newRefreshTokenHash = tokenService.hashRefreshToken(newRefreshTokenRaw);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: newRefreshTokenHash,
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
  const user = await UserAuth.findOne({
    emailVerifyToken: token,
    emailVerifyExpiry: { $gt: new Date() },
  });

  if (!user) {
    throw new AppError('Invalid or expired verification token', 400);
  }

  user.isEmailVerified = true;
  user.emailVerifyToken = null;
  user.emailVerifyExpiry = null;
  await user.save();

  logger.info('Email verified successfully', { userId: user._id.toString() });
}

// ─── Forgot Password ───────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  // Always return success to prevent email enumeration
  const user = await UserAuth.findOne({ email: email.toLowerCase() });

  if (user) {
    const resetToken = tokenService.generateSecureToken();
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    await emailService.sendPasswordResetEmail(user.email, resetToken).catch((err) => {
      logger.error('Failed to send password reset email', {
        userId: user._id.toString(),
        error: err instanceof Error ? err.message : 'Unknown',
      });
    });
  }

  // No error even if user not found — prevents email enumeration
}

// ─── Reset Password ────────────────────────────────────────────────

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const user = await UserAuth.findOne({
    resetPasswordToken: token,
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

  // Revoke all refresh tokens for this user (force re-login on all devices)
  await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  logger.info('Password reset successfully', { userId: user._id.toString() });
}

// ─── Helper: Generate Token Pair ────────────────────────────────────

async function generateTokenPair(
  user: IUserAuth,
  deviceInfo: DeviceInfo,
): Promise<TokenPair> {
  const accessToken = tokenService.signAccessToken({
    sub: user._id.toString(),
    email: user.email,
    roles: user.roles as UserRole[],
    permissions: user.permissions,
  });

  const refreshTokenRaw = tokenService.generateRefreshToken();
  const refreshTokenHash = tokenService.hashRefreshToken(refreshTokenRaw);
  const family = uuidv4(); // New family for each login

  await RefreshToken.create({
    userId: user._id,
    tokenHash: refreshTokenHash,
    family,
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
