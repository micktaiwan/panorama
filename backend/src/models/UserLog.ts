import mongoose, { Schema, Document } from 'mongoose';

export interface IUserLog extends Document {
  userId: mongoose.Types.ObjectId;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const userLogSchema = new Schema<IUserLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

export const UserLog = mongoose.model<IUserLog>('UserLog', userLogSchema, 'user_logs');
