import mongoose, { Schema, Document } from 'mongoose';

// --- Situation ---
export interface ISituation extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const situationSchema = new Schema<ISituation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Situation = mongoose.model<ISituation>('Situation', situationSchema);

// --- SituationActor ---
export interface ISituationActor extends Document {
  userId: mongoose.Types.ObjectId;
  situationId: mongoose.Types.ObjectId;
  personId: mongoose.Types.ObjectId | null;
  name: string;
  role: string;
  situationRole: string;
  createdAt: Date;
  updatedAt: Date;
}

const situationActorSchema = new Schema<ISituationActor>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    situationId: { type: Schema.Types.ObjectId, ref: 'Situation', required: true, index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: '' },
    situationRole: { type: String, default: '' },
  },
  { timestamps: true }
);

situationActorSchema.index({ situationId: 1, personId: 1 }, { unique: true, sparse: true });

export const SituationActor = mongoose.model<ISituationActor>('SituationActor', situationActorSchema, 'situation_actors');

// --- SituationNote ---
export interface ISituationNote extends Document {
  userId: mongoose.Types.ObjectId;
  situationId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId | null;
  content: string;
  createdAt: Date;
}

const situationNoteSchema = new Schema<ISituationNote>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    situationId: { type: Schema.Types.ObjectId, ref: 'Situation', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'SituationActor', default: null },
    content: { type: String, default: '' },
  },
  { timestamps: true }
);

export const SituationNote = mongoose.model<ISituationNote>('SituationNote', situationNoteSchema, 'situation_notes');

// --- SituationQuestion ---
export interface ISituationQuestion extends Document {
  userId: mongoose.Types.ObjectId;
  situationId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  questions: string[];
  createdAt: Date;
}

const situationQuestionSchema = new Schema<ISituationQuestion>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    situationId: { type: Schema.Types.ObjectId, ref: 'Situation', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'SituationActor', required: true },
    questions: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const SituationQuestion = mongoose.model<ISituationQuestion>('SituationQuestion', situationQuestionSchema, 'situation_questions');

// --- SituationSummary ---
export interface ISituationSummary extends Document {
  userId: mongoose.Types.ObjectId;
  situationId: mongoose.Types.ObjectId;
  text: string;
  createdAt: Date;
}

const situationSummarySchema = new Schema<ISituationSummary>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    situationId: { type: Schema.Types.ObjectId, ref: 'Situation', required: true, index: true },
    text: { type: String, default: '' },
  },
  { timestamps: true }
);

export const SituationSummary = mongoose.model<ISituationSummary>('SituationSummary', situationSummarySchema, 'situation_summaries');
