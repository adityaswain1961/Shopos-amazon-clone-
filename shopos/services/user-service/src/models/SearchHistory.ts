import mongoose, { Schema, type Document } from 'mongoose';

export interface ISearchHistory extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  query: string;
  searchedAt: Date;
}

const searchHistorySchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    query: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    searchedAt: {
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
searchHistorySchema.index({ userId: 1, searchedAt: -1 });

export const SearchHistory = mongoose.model<ISearchHistory>(
  'SearchHistory',
  searchHistorySchema,
);
