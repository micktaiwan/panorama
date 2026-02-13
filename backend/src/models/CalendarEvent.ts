import mongoose, { Schema, Document } from 'mongoose';

export interface ICalendarEvent extends Document {
  userId: mongoose.Types.ObjectId;
  uid: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  source: 'ics' | 'google' | 'manual';
  calendarId: string;
  htmlLink: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const calendarEventSchema = new Schema<ICalendarEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    uid: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    location: { type: String, default: '' },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    source: { type: String, enum: ['ics', 'google', 'manual'], default: 'manual' },
    calendarId: { type: String, default: '' },
    htmlLink: { type: String, default: '' },
    status: { type: String, default: 'confirmed' },
  },
  { timestamps: true }
);

calendarEventSchema.index({ start: 1, end: 1 });
calendarEventSchema.index({ userId: 1, uid: 1 }, { unique: true });

export const CalendarEvent = mongoose.model<ICalendarEvent>('CalendarEvent', calendarEventSchema, 'calendar_events');
