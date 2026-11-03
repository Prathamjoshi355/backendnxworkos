import mongoose, { Schema } from "mongoose";

export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "HALF_DAY"
  | "ON_LEAVE"
  | "UNPAID_LEAVE"
  | "WEEKLY_OFF"
  | "HOLIDAY"
  | "NOT_MARKED";
export type AttendanceCurrentStatus = "OFFLINE" | "ONLINE" | "ON_BREAK" | "LOGGED_OUT";

export interface IAttendanceCorrection {
  correctedBy: mongoose.Types.ObjectId | string;
  previousStatus?: AttendanceStatus;
  newStatus?: AttendanceStatus;
  previousTotalWorkDuration?: number;
  newTotalWorkDuration?: number;
  reason: string;
  correctedAt: Date;
}

export interface IAttendance extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId?: mongoose.Types.ObjectId | string | null;
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  date: Date;
  firstLoginAt?: Date | null;
  lastLogoutAt?: Date | null;
  checkInTime?: Date | null;
  checkOutTime?: Date | null;
  attendanceStatus: AttendanceStatus;
  totalWorkDuration: number;
  workingDuration: number;
  totalBreakDuration: number;
  currentStatus: AttendanceCurrentStatus;
  corrections?: IAttendanceCorrection[];
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    departmentId: { type: Schema.Types.Mixed, default: null, index: true },
    teamId: { type: Schema.Types.Mixed, default: null, index: true },
    date: { type: Date, required: true, index: true },
    firstLoginAt: { type: Date, default: null },
    lastLogoutAt: { type: Date, default: null },
    checkInTime: { type: Date, default: null, index: true },
    checkOutTime: { type: Date, default: null },
    workingDuration: { type: Number, default: 0 },
    attendanceStatus: {
      type: String,
      enum: ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "ON_LEAVE", "UNPAID_LEAVE", "WEEKLY_OFF", "HOLIDAY", "NOT_MARKED"],
      default: "NOT_MARKED",
      index: true,
    },
    totalWorkDuration: { type: Number, default: 0 },
    totalBreakDuration: { type: Number, default: 0 },
    currentStatus: { type: String, enum: ["OFFLINE", "ONLINE", "ON_BREAK", "LOGGED_OUT"], default: "OFFLINE" },
    corrections: {
      type: [
        {
          correctedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
          previousStatus: { type: String },
          newStatus: { type: String },
          previousTotalWorkDuration: { type: Number },
          newTotalWorkDuration: { type: Number },
          reason: { type: String, required: true },
          correctedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ organizationId: 1, date: 1 });
AttendanceSchema.index({ organizationId: 1, userId: 1, date: 1 });
AttendanceSchema.index({ teamId: 1, date: 1 });
AttendanceSchema.index({ currentStatus: 1 });

export const Attendance = (mongoose.models.Attendance as mongoose.Model<IAttendance>) || mongoose.model<IAttendance>("Attendance", AttendanceSchema);
export default Attendance;
