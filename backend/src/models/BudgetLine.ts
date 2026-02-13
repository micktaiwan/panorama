import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export interface IBudgetLine extends Document {
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  vendor: string;
  category: string;
  autoCategory: string;
  amountCents: number;
  vatCents: number;
  currency: string;
  projectId: mongoose.Types.ObjectId | null;
  invoiceId: string;
  invoiceNumber: string;
  publicFileUrl: string;
  analyticsCategory: string;
  analyticsWeight: number;
  sourceRef: string;
  notes: string;
  importBatch: string;
  importFile: string;
  importedAt: Date | null;
  dedupeHash: string;
  department: 'tech' | 'parked' | 'product' | 'other' | '';
  team: 'lemapp' | 'sre' | 'data' | 'pony' | 'cto' | '';
  createdAt: Date;
  updatedAt: Date;
}

const budgetLineSchema = new Schema<IBudgetLine>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true },
    vendor: { type: String, required: true, trim: true },
    category: { type: String, default: '' },
    autoCategory: { type: String, default: '' },
    amountCents: { type: Number, required: true },
    vatCents: { type: Number, default: 0 },
    currency: { type: String, default: 'EUR' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    invoiceId: { type: String, default: '' },
    invoiceNumber: { type: String, default: '' },
    publicFileUrl: { type: String, default: '' },
    analyticsCategory: { type: String, default: '' },
    analyticsWeight: { type: Number, default: 1 },
    sourceRef: { type: String, default: '' },
    notes: { type: String, default: '' },
    importBatch: { type: String, default: '', index: true },
    importFile: { type: String, default: '' },
    importedAt: { type: Date, default: null },
    dedupeHash: { type: String, default: '', index: true },
    department: { type: String, enum: ['tech', 'parked', 'product', 'other', ''], default: '' },
    team: { type: String, enum: ['lemapp', 'sre', 'data', 'pony', 'cto', ''], default: '' },
  },
  { timestamps: true }
);

budgetLineSchema.index({ date: 1, category: 1, vendor: 1 });
budgetLineSchema.index({ department: 1, date: -1 });

export function computeDedupeHash(line: { date: string; amountCents: number; vendor: string }): string {
  const raw = `${line.date}|${line.amountCents}|${line.vendor.toLowerCase().trim()}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

export const BudgetLine = mongoose.model<IBudgetLine>('BudgetLine', budgetLineSchema, 'budget_lines');
