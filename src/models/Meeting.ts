import mongoose, { Schema } from "mongoose";

export type MeetingType = "IN_PERSON" | "ONLINE" | "HYBRID";
export type MeetingStatus = "SCHEDULED" | "STARTED" | "COMPLETED" | "CANCELLED";

export interface IMeetingParticipant {
  userId: mongoose.Types.ObjectId | string;
  responseStatus: "PENDING" | "ACCEPTED" | "DECLINED" | "TENTATIVE";
}

export interface IMeeting extends mongoose.Document {
  meetingId: string;
  organizationId: mongoose.Types.ObjectId | string;
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  title: string;
  description?: string | null;
  organizerId: mongoose.Types.ObjectId | string;
  participants: IMeetingParticipant[];
  meetingType: MeetingType;
  date: Date;
  startTime: string;
  endTime: string;
  location?: string | null;
  meetingLink?: string | null;
  status: MeetingStatus;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ParticipantSchema = new Schema<IMeetingParticipant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    responseStatus: { type: String, enum: ["PENDING", "ACCEPTED", "DECLINED", "TENTATIVE"], default: "PENDING" },
  },
  { _id: false }
);

const MeetingSchema = new Schema<IMeeting>(
  {
    meetingId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null, index: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    organizerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    participants: { type: [ParticipantSchema], default: [] },
    meetingType: { type: String, enum: ["IN_PERSON", "ONLINE", "HYBRID"], default: "ONLINE" },
    date: { type: Date, required: true, index: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    location: { type: String, default: null },
    meetingLink: { type: String, default: null },
    status: { type: String, enum: ["SCHEDULED", "STARTED", "COMPLETED", "CANCELLED"], default: "SCHEDULED", index: true },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

MeetingSchema.index({ organizationId: 1, date: 1 });
MeetingSchema.index({ "participants.userId": 1, date: 1 });

export const Meeting = (mongoose.models.Meeting as mongoose.Model<IMeeting>) || mongoose.model<IMeeting>("Meeting", MeetingSchema);
export default Meeting;
