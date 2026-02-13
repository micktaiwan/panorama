import mongoose, { Schema, Document } from 'mongoose';

export interface IAlarm extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  enabled: boolean;
  nextTriggerAt: Date;
  recurrence: {
    type: 'none' | 'daily' | 'weekly' | 'monthly';
    daysOfWeek?: number[];
  };
  snoozedUntilAt: Date | null;
  done: boolean;
  acknowledgedAt: Date | null;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const alarmSchema = new Schema<IAlarm>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, default: 'Alarm' },
    enabled: { type: Boolean, default: true },
    nextTriggerAt: { type: Date, required: true },
    recurrence: {
      type: {
        type: String,
        enum: ['none', 'daily', 'weekly', 'monthly'],
        default: 'none',
      },
      daysOfWeek: { type: [Number], default: undefined },
    },
    snoozedUntilAt: { type: Date, default: null },
    done: { type: Boolean, default: false },
    acknowledgedAt: { type: Date, default: null },
    lastFiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Alarm = mongoose.model<IAlarm>('Alarm', alarmSchema);
