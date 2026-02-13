import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITask extends Document {
  userId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  urgent: boolean;
  important: boolean;
  deadline: Date | null;
  scheduledDate: Date | null;
  estimate: number | null;
  actual: number | null;
  progressPercent: number;
  rank: number;
  statusChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    description: {
      type: String,
      default: '',
      maxlength: 10000,
    },
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'done', 'cancelled'],
      default: 'todo',
    },
    urgent: {
      type: Boolean,
      default: false,
    },
    important: {
      type: Boolean,
      default: false,
    },
    deadline: {
      type: Date,
      default: null,
    },
    scheduledDate: {
      type: Date,
      default: null,
    },
    estimate: {
      type: Number,
      default: null,
    },
    actual: {
      type: Number,
      default: null,
    },
    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    rank: {
      type: Number,
      default: 0,
    },
    statusChangedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

TaskSchema.index({ userId: 1, projectId: 1, status: 1 });
TaskSchema.index({ userId: 1, urgent: 1, important: 1 });
TaskSchema.index({ userId: 1, deadline: 1 });

export const Task = mongoose.model<ITask>('Task', TaskSchema);
