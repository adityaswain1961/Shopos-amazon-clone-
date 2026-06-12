import mongoose, { Schema, type Document } from 'mongoose';

export interface ISession extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  deviceName: string;
  ip: string;
  location: string;
  lastActiveAt: Date;
  createdAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'UserAuth',
      required: true,
      index: true,
    },
    deviceName: {
      type: String,
      default: 'Unknown Device',
    },
    ip: {
      type: String,
      default: '',
    },
    location: {
      type: String,
      default: '',
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export const Session = mongoose.model<ISession>('Session', sessionSchema);
