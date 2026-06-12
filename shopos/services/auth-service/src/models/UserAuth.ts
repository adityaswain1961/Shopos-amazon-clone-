import mongoose, { Schema, type Document } from 'mongoose';
import type { OAuthProvider } from '@shopos/shared-types';

export interface IUserAuth extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  roles: string[];
  permissions: string[];
  isEmailVerified: boolean;
  emailVerifyToken: string | null;
  emailVerifyExpiry: Date | null;
  resetPasswordToken: string | null;
  resetPasswordExpiry: Date | null;
  failedLoginAttempts: number;
  lockoutUntil: Date | null;
  twoFactorSecret: string | null;
  twoFactorEnabled: boolean;
  oauthProviders: OAuthProvider[];
  createdAt: Date;
  updatedAt: Date;
}

const oauthProviderSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ['google', 'github', 'apple'],
      required: true,
    },
    providerId: { type: String, required: true },
    accessToken: { type: String },
  },
  { _id: false },
);

const userAuthSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    roles: {
      type: [{ type: String, enum: ['customer', 'seller', 'admin', 'support', 'super_admin'] }],
      default: ['customer'],
    },
    permissions: {
      type: [{ type: String }],
      default: [],
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerifyToken: {
      type: String,
      default: null,
    },
    emailVerifyExpiry: {
      type: Date,
      default: null,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpiry: {
      type: Date,
      default: null,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockoutUntil: {
      type: Date,
      default: null,
    },
    twoFactorSecret: {
      type: String,
      default: null,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    oauthProviders: {
      type: [oauthProviderSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        // Never expose sensitive fields in JSON serialization
        delete ret['passwordHash'];
        delete ret['twoFactorSecret'];
        delete ret['emailVerifyToken'];
        delete ret['resetPasswordToken'];
        return ret;
      },
    },
  },
);

export const UserAuth = mongoose.model<IUserAuth>('UserAuth', userAuthSchema);
