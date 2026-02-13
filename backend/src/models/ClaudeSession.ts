import mongoose, { Schema, Types } from 'mongoose';

export interface IClaudeSession {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  cwd: string;
  model: string;
  permissionMode: string;
  appendSystemPrompt: string;
  claudeSessionId: string | null;
  claudeCodeVersion: string;
  activeModel: string;
  activeAgent: string;
  status: 'idle' | 'running' | 'error';
  pid: number | null;
  lastError: string | null;
  totalCostUsd: number;
  totalDurationMs: number;
  lastModelUsage: Record<string, unknown>;
  queuedCount: number;
  unseenCompleted: boolean;
  claudeEffort: string;
  codexModel: string;
  codexReasoningEffort: string;
  codexRunning: boolean;
  debateRunning: boolean;
  debateRound: number | null;
  debateCurrentAgent: string | null;
  debateSubject: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ClaudeSessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'ClaudeProject',
      required: true,
      index: true,
    },
    name: {
      type: String,
      default: 'Session',
      trim: true,
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
    claudeSessionId: {
      type: String,
      default: null,
    },
    claudeCodeVersion: {
      type: String,
      default: '',
    },
    activeModel: {
      type: String,
      default: '',
    },
    activeAgent: {
      type: String,
      default: 'claude',
    },
    status: {
      type: String,
      enum: ['idle', 'running', 'error'],
      default: 'idle',
    },
    pid: {
      type: Number,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    totalCostUsd: {
      type: Number,
      default: 0,
    },
    totalDurationMs: {
      type: Number,
      default: 0,
    },
    lastModelUsage: {
      type: Schema.Types.Mixed,
      default: {},
    },
    queuedCount: {
      type: Number,
      default: 0,
    },
    unseenCompleted: {
      type: Boolean,
      default: false,
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
    codexRunning: {
      type: Boolean,
      default: false,
    },
    debateRunning: {
      type: Boolean,
      default: false,
    },
    debateRound: {
      type: Number,
      default: null,
    },
    debateCurrentAgent: {
      type: String,
      default: null,
    },
    debateSubject: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ClaudeSessionSchema.index({ projectId: 1, createdAt: 1 });

export const ClaudeSession = mongoose.model<IClaudeSession>('ClaudeSession', ClaudeSessionSchema);
