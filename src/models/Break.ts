import mongoose, { Schema } from "mongoose";

export type BreakType = "LUNCH" | "SHORT_BREAK" | "PERSONAL" | "OTHER";
export type BreakStatus = "ACTIVE" | "COMPLETED";

export interface IAttendanceBreak extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  attendanceId: mongoose.Types.ObjectId | string;
  type: BreakType;
  startedAt: Date;
  endedAt?: Date | null;
  duration: number;
  status: BreakStatus;
  createdAt: Date;
  updatedAt: Date;
}

const BreakSchema = new Schema<IAttendanceBreak>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: "Attendance", required: true, index: true },
    type: { type: String, enum: ["LUNCH", "SHORT_BREAK", "PERSONAL", "OTHER"], required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: 0 },
    status: { type: String, enum: ["ACTIVE", "COMPLETED"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

BreakSchema.index({ userId: 1, createdAt: 1 });
BreakSchema.index({ attendanceId: 1 });

export const AttendanceBreak = (mongoose.models.Break as mongoose.Model<IAttendanceBreak>) || mongoose.model<IAttendanceBreak>("Break", BreakSchema);
export default AttendanceBreak;
