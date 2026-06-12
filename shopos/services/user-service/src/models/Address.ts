import mongoose, { Schema, type Document } from 'mongoose';

export interface IAddress extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  label: 'home' | 'work' | 'other';
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
}

const addressSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    label: {
      type: String,
      enum: ['home', 'work', 'other'],
      default: 'home',
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    line1: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    line2: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      required: true,
      trim: true,
    },
    country: {
      type: String,
      required: true,
      trim: true,
    },
    postalCode: {
      type: String,
      required: true,
      trim: true,
    },
    isDefaultShipping: {
      type: Boolean,
      default: false,
    },
    isDefaultBilling: {
      type: Boolean,
      default: false,
    },
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
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

// Compound index for efficient user address lookups
addressSchema.index({ userId: 1, createdAt: -1 });

export const Address = mongoose.model<IAddress>('Address', addressSchema);
