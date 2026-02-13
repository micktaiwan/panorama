import mongoose, { Schema, Document } from 'mongoose';

export interface ILink extends Document {
  userId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId | null;
  name: string;
  url: string;
  clicksCount: number;
  lastClickedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function ensureHttpUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const linkSchema = new Schema<ILink>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    clicksCount: { type: Number, default: 0 },
    lastClickedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

linkSchema.pre('save', function () {
  this.url = ensureHttpUrl(this.url);
});

export const Link = mongoose.model<ILink>('Link', linkSchema);
