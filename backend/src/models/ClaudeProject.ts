import mongoose, { Schema, Types } from 'mongoose';

export interface IClaudeProject {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  cwd: string;
  model: string;
  permissionMode: string;
  appendSystemPrompt: string;
  linkedProjectId: Types.ObjectId | null;
  claudeEffort: string;
  codexModel: string;
  codexReasoningEffort: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClaudeProjectSchema = new Schema(
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
    cwd: {
      type: String,
      default: '',
    },
    model: {
      type: String,
      default: '',
    },
    permissionMode: {
      type: String,
      default: '',
    },
    appendSystemPrompt: {
      type: String,
      default: '',
    },
    linkedProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },
    claudeEffort: {
      type: String,
      default: '',
    },
    codexModel: {
      type: String,
      default: '',
    },
    codexReasoningEffort: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

ClaudeProjectSchema.index({ userId: 1, updatedAt: -1 });

export const ClaudeProject = mongoose.model<IClaudeProject>('ClaudeProject', ClaudeProjectSchema);
