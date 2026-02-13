import mongoose, { Schema, Document, Types } from 'mongoose';

export interface INote extends Document {
  userId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INote>(
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
      default: '',
      trim: true,
      maxlength: 500,
    },
    content: {
      type: String,
      default: '',
      maxlength: 100000,
    },
  },
  {
    timestamps: true,
  }
);

NoteSchema.index({ userId: 1, projectId: 1 });

export const Note = mongoose.model<INote>('Note', NoteSchema);
