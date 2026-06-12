import { z } from 'zod';

// ─── Password Validation ────────────────────────────────────────────

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// ─── Register ───────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .trim()
    .toLowerCase(),
  password: passwordSchema,
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// ─── Login ──────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .trim()
    .toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ─── Refresh Token ──────────────────────────────────────────────────

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

// ─── Forgot Password ───────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .trim()
    .toLowerCase(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// ─── Reset Password ────────────────────────────────────────────────

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─── Verify Email (query params) ────────────────────────────────────

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
