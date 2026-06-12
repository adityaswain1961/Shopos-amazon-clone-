import mongoose, { Schema, type Document } from 'mongoose';
import crypto from 'node:crypto';

export interface IWishlistItem {
  productId: string;
  variantId?: string;
  addedAt: Date;
}

export interface IWishlist extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  name: string;
  isPublic: boolean;
  shareToken: string;
  items: IWishlistItem[];
  createdAt: Date;
}

const wishlistItemSchema = new Schema(
  {
    productId: { type: String, required: true },
    variantId: { type: String },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const wishlistSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    shareToken: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(16).toString('hex'),
    },
    items: {
      type: [wishlistItemSchema],
      default: [],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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

export const Wishlist = mongoose.model<IWishlist>('Wishlist', wishlistSchema);
