import mongoose, { Schema, type Document } from 'mongoose';

export interface IRecentlyViewed extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  productId: string;
  viewedAt: Date;
}

const recentlyViewedSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    productId: {
      type: String,
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
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

// Compound index for efficient per-user lookups sorted by recency
recentlyViewedSchema.index({ userId: 1, viewedAt: -1 });

// TTL index: auto-delete entries older than 90 days
recentlyViewedSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Unique compound: prevent duplicate product entries per user
// (service layer upserts on view)
recentlyViewedSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const RecentlyViewed = mongoose.model<IRecentlyViewed>(
  'RecentlyViewed',
  recentlyViewedSchema,
);
