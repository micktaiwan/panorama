import mongoose, { Schema, Document } from 'mongoose';

export interface IGmailToken extends Document {
  userId: mongoose.Types.ObjectId;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  createdAt: Date;
  updatedAt: Date;
}

const GmailTokenSchema = new Schema<IGmailToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiryDate: { type: Number, required: true },
  },
  { timestamps: true },
);

export const GmailToken = mongoose.model<IGmailToken>('GmailToken', GmailTokenSchema);

// --- Gmail Messages ---

export interface IGmailMessage extends Document {
  userId: mongoose.Types.ObjectId;
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  body?: string;
  snippet?: string;
  labelIds: string[];
  gmailDate: Date;
  isRead: boolean;
  isImportant: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GmailMessageSchema = new Schema<IGmailMessage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messageId: { type: String, required: true },
    threadId: { type: String, required: true },
    subject: { type: String, default: '' },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    body: String,
    snippet: String,
    labelIds: { type: [String], default: [] },
    gmailDate: { type: Date, required: true },
    isRead: { type: Boolean, default: false },
    isImportant: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

GmailMessageSchema.index({ userId: 1, messageId: 1 }, { unique: true });
GmailMessageSchema.index({ userId: 1, threadId: 1 });
GmailMessageSchema.index({ userId: 1, gmailDate: -1 });

export const GmailMessage = mongoose.model<IGmailMessage>('GmailMessage', GmailMessageSchema);

// --- Email Action Logs ---

export interface IEmailActionLog extends Document {
  userId: mongoose.Types.ObjectId;
  messageId: string;
  action: string;
  createdAt: Date;
}

const EmailActionLogSchema = new Schema<IEmailActionLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messageId: { type: String, required: true },
    action: { type: String, required: true },
  },
  { timestamps: { updatedAt: false } },
);

export const EmailActionLog = mongoose.model<IEmailActionLog>('EmailActionLog', EmailActionLogSchema);
