import mongoose, { Schema } from "mongoose";

export type WorkSessionStatus = "ACTIVE" | "COMPLETED";

export interface IWorkSession extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  attendanceId: mongoose.Types.ObjectId | string;
  loginAt: Date;
  logoutAt?: Date | null;
  duration: number;
  status: WorkSessionStatus;
  deviceType?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const WorkSessionSchema = new Schema<IWorkSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: "Attendance", required: true, index: true },
    loginAt: { type: Date, required: true },
    logoutAt: { type: Date, default: null },
    duration: { type: Number, default: 0 },
    status: { type: String, enum: ["ACTIVE", "COMPLETED"], default: "ACTIVE", index: true },
    deviceType: { type: String, default: "WEB" },
  },
  { timestamps: true }
);

WorkSessionSchema.index({ userId: 1, createdAt: 1 });
WorkSessionSchema.index({ attendanceId: 1 });

export const WorkSession = (mongoose.models.WorkSession as mongoose.Model<IWorkSession>) || mongoose.model<IWorkSession>("WorkSession", WorkSessionSchema);
export default WorkSession;
