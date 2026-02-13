import mongoose, { Schema, Types } from 'mongoose';

export interface IClaudeMessage {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  role: string;
  type: string;
  content: any[];
  contentText: string;
  claudeSessionId: string;
  model: string;
  isStreaming: boolean;
  durationMs: number;
  usage: Record<string, unknown>;
  costUsd: number;
  queued: boolean;
  toolName: string;
  toolInput: Record<string, unknown>;
  autoResponded: boolean;
  autoRespondedMode: string;
  shellCommand: string;
  shellExitCode: number | null;
  codexPrompt: string;
  codexExitCode: number | null;
  codexUsage: Record<string, unknown>;
  debateAgent: string;
  debateRound: number;
  debateAgreed: boolean | null;
  debateRounds: number;
  debateOutcome: string;
  createdAt: Date;
}

const ClaudeMessageSchema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ClaudeSession',
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    content: {
      type: Schema.Types.Mixed,
      default: [],
    },
    contentText: {
      type: String,
      default: '',
    },
    claudeSessionId: {
      type: String,
      default: '',
    },
    model: {
      type: String,
      default: '',
    },
    isStreaming: {
      type: Boolean,
      default: false,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    usage: {
      type: Schema.Types.Mixed,
      default: null,
    },
    costUsd: {
      type: Number,
      default: 0,
    },
    queued: {
      type: Boolean,
      default: false,
    },
    toolName: String,
    toolInput: Schema.Types.Mixed,
    autoResponded: Boolean,
    autoRespondedMode: String,
    shellCommand: String,
    shellExitCode: Number,
    codexPrompt: String,
    codexExitCode: Number,
    codexUsage: Schema.Types.Mixed,
    debateAgent: String,
    debateRound: Number,
    debateAgreed: { type: Boolean, default: null },
    debateRounds: Number,
    debateOutcome: String,
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

ClaudeMessageSchema.index({ sessionId: 1, createdAt: 1 });

export const ClaudeMessage = mongoose.model<IClaudeMessage>('ClaudeMessage', ClaudeMessageSchema);
