import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ─── Provider Interface ─────────────────────────────────────────────

interface EmailProvider {
  sendEmail(to: string, subject: string, html: string): Promise<void>;
}

// ─── Resend Provider ────────────────────────────────────────────────

class ResendProvider implements EmailProvider {
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    await this.client.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
  }
}

// ─── Nodemailer Provider (SMTP fallback for dev) ────────────────────

class NodemailerProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      ...(env.SMTP_USER && env.SMTP_PASS
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    });
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
  }
}

// ─── Provider Selection ─────────────────────────────────────────────

function getProvider(): EmailProvider {
  if (env.RESEND_API_KEY) {
    return new ResendProvider(env.RESEND_API_KEY);
  }
  return new NodemailerProvider();
}

const provider = getProvider();

// ─── Email Templates ────────────────────────────────────────────────

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8f9fa;">
      <div style="background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
        <h1 style="color: #111827; margin-bottom: 16px; font-size: 24px;">Welcome to ShopOS!</h1>
        <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
          Thanks for creating an account. Please verify your email address by clicking the button below.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
            Verify Email
          </a>
        </div>
        <p style="color: #9ca3af; font-size: 13px;">
          This link expires in 15 minutes. If you didn't create an account, please ignore this email.
        </p>
      </div>
    </body>
    </html>
  `;

  await provider.sendEmail(to, 'Verify your ShopOS email', html);
  logger.info('Verification email sent', { to });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8f9fa;">
      <div style="background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
        <h1 style="color: #111827; margin-bottom: 16px; font-size: 24px;">Reset Your Password</h1>
        <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
          You requested a password reset. Click the button below to set a new password.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="background-color: #dc2626; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="color: #9ca3af; font-size: 13px;">
          This link expires in 15 minutes. If you didn't request a password reset, your account is safe — just ignore this email.
        </p>
      </div>
    </body>
    </html>
  `;

  await provider.sendEmail(to, 'Reset your ShopOS password', html);
  logger.info('Password reset email sent', { to });
}
