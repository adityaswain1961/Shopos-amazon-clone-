import mongoose, { Schema, type Document } from 'mongoose';

export interface IRefreshToken extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  family: string;
  deviceInfo: {
    ua: string;
    ip: string;
    fingerprint?: string;
  };
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'UserAuth',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    family: {
      type: String,
      required: true,
      index: true,
    },
    deviceInfo: {
      ua: { type: String, default: '' },
      ip: { type: String, default: '' },
      fingerprint: { type: String },
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index: MongoDB auto-deletes expired docs
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export const RefreshToken = mongoose.model<IRefreshToken>(
  'RefreshToken',
  refreshTokenSchema,
);
