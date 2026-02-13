import mongoose, { Schema, Document } from 'mongoose';

export interface IFileDoc extends Document {
  userId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId | null;
  name: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  clicksCount: number;
  lastClickedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const fileDocSchema = new Schema<IFileDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    name: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, unique: true },
    mimeType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    clicksCount: { type: Number, default: 0 },
    lastClickedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const FileDoc = mongoose.model<IFileDoc>('FileDoc', fileDocSchema, 'files');
