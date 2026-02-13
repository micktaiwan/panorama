import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProject extends Document {
  userId: Types.ObjectId;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'done' | 'archived';
  targetDate: Date | null;
  progressPercent: number;
  riskLevel: 'low' | 'medium' | 'high' | null;
  isFavorite: boolean;
  rank: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: '',
      maxlength: 10000,
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'done', 'archived'],
      default: 'active',
    },
    targetDate: {
      type: Date,
      default: null,
    },
    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', null],
      default: null,
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    rank: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

ProjectSchema.index({ userId: 1, status: 1 });
ProjectSchema.index({ userId: 1, isFavorite: -1, rank: 1 });

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
