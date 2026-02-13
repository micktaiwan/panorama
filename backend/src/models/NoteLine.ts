import mongoose, { Schema, Document, Types } from 'mongoose';

export interface INoteLine extends Document {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  content: string;
  createdAt: Date;
}

const NoteLineSchema = new Schema<INoteLine>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'NoteSession',
      required: true,
      index: true,
    },
    content: {
      type: String,
      default: '',
      maxlength: 50000,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'note_lines',
  }
);

export const NoteLine = mongoose.model<INoteLine>('NoteLine', NoteLineSchema);
