import mongoose, { Schema, Document } from 'mongoose';

export interface IMCPServer extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  type: 'stdio' | 'http';
  enabled: boolean;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http
  url?: string;
  headers?: Record<string, string>;
  // tracking
  lastConnectedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MCPServerSchema = new Schema<IMCPServer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['stdio', 'http'], required: true },
    enabled: { type: Boolean, default: true },
    command: String,
    args: [String],
    env: { type: Schema.Types.Mixed, default: {} },
    url: String,
    headers: { type: Schema.Types.Mixed, default: {} },
    lastConnectedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

MCPServerSchema.index({ userId: 1, name: 1 }, { unique: true });

export const MCPServer = mongoose.model<IMCPServer>('MCPServer', MCPServerSchema);
