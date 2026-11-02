import mongoose, { Schema } from "mongoose";

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface ILeave extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId: mongoose.Types.ObjectId | string;
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  leaveTypeId?: mongoose.Types.ObjectId | string | null;
  leaveTypeName: string;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  appliedAt: Date;
  reviewedAt?: Date | null;
  reviewedBy?: mongoose.Types.ObjectId | string | null;
  reviewerComment?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveSchema = new Schema<ILeave>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null, index: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: "LeaveType", default: null },
    leaveTypeName: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true, default: 1 },
    reason: { type: String, required: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"], default: "PENDING", index: true },
    appliedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewerComment: { type: String, default: null },
  },
  { timestamps: true }
);

LeaveSchema.index({ userId: 1, startDate: 1, endDate: 1 });
LeaveSchema.index({ organizationId: 1, status: 1, startDate: -1 });
LeaveSchema.index({ organizationId: 1, userId: 1, startDate: -1 });
LeaveSchema.index({ organizationId: 1, leaveTypeId: 1, status: 1 });
LeaveSchema.index({ teamId: 1, status: 1, startDate: -1 });
LeaveSchema.index({ departmentId: 1, status: 1, startDate: -1 });

export const Leave = (mongoose.models.Leave as mongoose.Model<ILeave>) || mongoose.model<ILeave>("Leave", LeaveSchema);
export default Leave;
