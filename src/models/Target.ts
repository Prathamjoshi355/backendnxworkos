import mongoose, { Schema } from "mongoose";

export type TargetType = "TASKS" | "CALLS" | "LEADS" | "MEETINGS" | "CUSTOM";
export type TargetPeriodType = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY";
export type TargetStatus = "ACTIVE" | "PAUSED" | "ACHIEVED" | "EXPIRED" | "CANCELLED";

export interface ITarget extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId: mongoose.Types.ObjectId | string;
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  type: TargetType;
  title: string;
  targetValue: number;
  currentValue: number;
  periodType: TargetPeriodType;
  startDate: Date;
  endDate: Date;
  status: TargetStatus;
  createdBy: mongoose.Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}

const TargetSchema = new Schema<ITarget>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    type: { type: String, enum: ["TASKS", "CALLS", "LEADS", "MEETINGS", "CUSTOM"], required: true },
    title: { type: String, required: true },
    targetValue: { type: Number, required: true, min: 0 },
    currentValue: { type: Number, default: 0, min: 0 },
    periodType: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY"], required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ["ACTIVE", "PAUSED", "ACHIEVED", "EXPIRED", "CANCELLED"], default: "ACTIVE", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Indexes for efficient querying
TargetSchema.index({ userId: 1, status: 1, periodType: 1 });
TargetSchema.index({ organizationId: 1, startDate: -1 });
TargetSchema.index({ userId: 1, startDate: 1, endDate: 1 });
TargetSchema.index({ type: 1, status: 1 });

export const Target =
  (mongoose.models.Target as mongoose.Model<ITarget>) ||
  mongoose.model<ITarget>("Target", TargetSchema);
