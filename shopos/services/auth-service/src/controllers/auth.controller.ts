import type { Request, Response, NextFunction } from 'express';
import * as authService from '../services/authService.js';
import * as sessionService from '../services/sessionService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import type { DeviceInfo } from '@shopos/shared-types';

// ─── Helper: Extract device info from request ──────────────────────

function getDeviceInfo(req: Request): DeviceInfo {
  return {
    ua: req.headers['user-agent'] || 'Unknown',
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    fingerprint: req.headers['x-device-fingerprint'] as string | undefined,
  };
}

// ─── Register ───────────────────────────────────────────────────────

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password, name } = req.body;
    const result = await authService.register({ email, password, name });
    sendSuccess(res, result, 201);
  } catch (error) {
    next(error);
  }
}

// ─── Login ──────────────────────────────────────────────────────────

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = req.body;
    const deviceInfo = getDeviceInfo(req);
    const result = await authService.login({ email, password, deviceInfo });
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

// ─── Logout ─────────────────────────────────────────────────────────

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader ? authHeader.substring(7) : '';
    const refreshToken = req.body.refreshToken || '';

    await authService.logout(accessToken, refreshToken);
    sendSuccess(res, { message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
}

// ─── Refresh Tokens ─────────────────────────────────────────────────

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { refreshToken } = req.body;
    const deviceInfo = getDeviceInfo(req);
    const result = await authService.refreshTokens(refreshToken, deviceInfo);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

// ─── Verify Email ───────────────────────────────────────────────────

export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.query.token as string;
    await authService.verifyEmail(token);
    sendSuccess(res, { message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
}

// ─── Forgot Password ───────────────────────────────────────────────

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = req.body;
    await authService.forgotPassword(email);
    // Always return success to prevent email enumeration
    sendSuccess(res, {
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    next(error);
  }
}

// ─── Reset Password ────────────────────────────────────────────────

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token, password } = req.body;
    await authService.resetPassword(token, password);
    sendSuccess(res, { message: 'Password has been reset successfully' });
  } catch (error) {
    next(error);
  }
}

// ─── List Sessions ──────────────────────────────────────────────────

export async function listSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }
    const sessions = await sessionService.listSessions(req.user.sub);
    sendSuccess(res, { sessions });
  } catch (error) {
    next(error);
  }
}

// ─── Revoke Session ─────────────────────────────────────────────────

export async function revokeSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }
    const sessionId = req.params['sessionId'] as string;
    await sessionService.revokeSession(sessionId, req.user.sub);
    sendSuccess(res, { message: 'Session revoked successfully' });
  } catch (error) {
    next(error);
  }
}

// ─── Revoke All Sessions ───────────────────────────────────────────

export async function revokeAllSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }
    await sessionService.revokeAllSessions(req.user.sub);
    sendSuccess(res, { message: 'All sessions revoked successfully' });
  } catch (error) {
    next(error);
  }
}
