import mongoose, { Schema, type Document } from 'mongoose';

// ─── Notification Preferences ───────────────────────────────────────

export interface INotificationPrefs {
  email: boolean;
  sms: boolean;
  push: boolean;
  promotions: boolean;
}

// ─── User Profile Interface ─────────────────────────────────────────

export interface IUserProfile extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;                 // matches auth service ObjectId
  displayName: string;
  bio: string;
  phone: string;
  dateOfBirth: Date | null;
  avatarUrl: string;
  language: string;
  currency: string;
  profilePublic: boolean;
  completionPercent: number;
  notificationPrefs: INotificationPrefs;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ─────────────────────────────────────────────────────────

const notificationPrefsSchema = new Schema(
  {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    promotions: { type: Boolean, default: false },
  },
  { _id: false },
);

const userProfileSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    displayName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },
    bio: {
      type: String,
      default: '',
      maxlength: 500,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    language: {
      type: String,
      default: 'en',
    },
    currency: {
      type: String,
      default: 'INR',
    },
    profilePublic: {
      type: Boolean,
      default: true,
    },
    completionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    notificationPrefs: {
      type: notificationPrefsSchema,
      default: () => ({
        email: true,
        sms: true,
        push: true,
        promotions: false,
      }),
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret['id'] = ret['_id'];
        delete ret['_id'];
        delete ret['__v'];
        return ret;
      },
    },
  },
);

export const UserProfile = mongoose.model<IUserProfile>('UserProfile', userProfileSchema);
