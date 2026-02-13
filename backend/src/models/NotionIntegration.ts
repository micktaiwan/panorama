import mongoose, { Schema, Document } from 'mongoose';

export interface INotionIntegration extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  databaseId: string;
  description?: string;
  filters: {
    squadName?: string;
    lifecycle?: string[];
    ownerIds?: string[];
  };
  ownerMapping?: Record<string, string>;
  pageSize: number;
  enabled: boolean;
  lastSyncAt?: Date;
  syncInProgress: boolean;
  syncProgress?: {
    current: number;
    pageCount: number;
    status: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const NotionIntegrationSchema = new Schema<INotionIntegration>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    databaseId: { type: String, required: true },
    description: String,
    filters: {
      squadName: String,
      lifecycle: [String],
      ownerIds: [String],
    },
    ownerMapping: { type: Schema.Types.Mixed, default: {} },
    pageSize: { type: Number, default: 100 },
    enabled: { type: Boolean, default: true },
    lastSyncAt: Date,
    syncInProgress: { type: Boolean, default: false },
    syncProgress: {
      current: Number,
      pageCount: Number,
      status: String,
    },
  },
  { timestamps: true },
);

export const NotionIntegration = mongoose.model<INotionIntegration>(
  'NotionIntegration',
  NotionIntegrationSchema,
);

// --- Notion Tickets ---

export interface INotionTicket extends Document {
  userId: mongoose.Types.ObjectId;
  integrationId: mongoose.Types.ObjectId;
  notionId: string;
  ticketId?: number;
  title: string;
  owners: { id: string; name: string }[];
  age?: string;
  priority?: string;
  lifecycle?: string;
  nextStep?: string;
  url?: string;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotionTicketSchema = new Schema<INotionTicket>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    integrationId: { type: Schema.Types.ObjectId, ref: 'NotionIntegration', required: true, index: true },
    notionId: { type: String, required: true },
    ticketId: Number,
    title: { type: String, required: true },
    owners: [{ id: String, name: String }],
    age: String,
    priority: String,
    lifecycle: String,
    nextStep: String,
    url: String,
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

NotionTicketSchema.index({ integrationId: 1, notionId: 1 }, { unique: true });
NotionTicketSchema.index({ syncedAt: 1 });

export const NotionTicket = mongoose.model<INotionTicket>('NotionTicket', NotionTicketSchema);
