import mongoose, { Schema, Document } from 'mongoose';

export interface IPerson extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  lastName: string;
  normalizedName: string;
  aliases: string[];
  email: string;
  role: string;
  notes: string;
  left: boolean;
  contactOnly: boolean;
  teamId: mongoose.Types.ObjectId | null;
  subteam: string;
  arrivalDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeName(name: string, lastName?: string): string {
  const full = [name, lastName].filter(Boolean).join(' ');
  return full.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const personSchema = new Schema<IPerson>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    lastName: { type: String, default: '', trim: true },
    normalizedName: { type: String, default: '' },
    aliases: { type: [String], default: [] },
    email: { type: String, default: '', trim: true, lowercase: true },
    role: { type: String, default: '' },
    notes: { type: String, default: '' },
    left: { type: Boolean, default: false },
    contactOnly: { type: Boolean, default: false },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    subteam: { type: String, default: '' },
    arrivalDate: { type: Date, default: null },
  },
  { timestamps: true }
);

personSchema.pre('save', function () {
  this.normalizedName = normalizeName(this.name, this.lastName);
  if (this.aliases) {
    this.aliases = [...new Set(this.aliases.map(a => a.trim()).filter(Boolean))];
  }
});

export const Person = mongoose.model<IPerson>('Person', personSchema);
