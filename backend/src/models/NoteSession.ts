import mongoose, { Schema, Document, Types } from 'mongoose';

export interface INoteSession extends Document {
  userId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const NoteSessionSchema = new Schema<INoteSession>(
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
  },
  {
    timestamps: true,
    collection: 'note_sessions',
  }
);

export const NoteSession = mongoose.model<INoteSession>('NoteSession', NoteSessionSchema);
