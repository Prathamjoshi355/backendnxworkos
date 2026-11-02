import mongoose, { Schema } from "mongoose";

export interface ILeaveType extends mongoose.Document {
  name: string;
  code: string;
  organizationId: mongoose.Types.ObjectId | string;
  allocatedDays: number;
  isPaid: boolean;
  allowNegativeBalance: boolean;
  status: "ACTIVE" | "INACTIVE";
  createdAt: Date;
  updatedAt: Date;
}

const LeaveTypeSchema = new Schema<ILeaveType>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    allocatedDays: { type: Number, default: 12 },
    isPaid: { type: Boolean, default: true },
    allowNegativeBalance: { type: Boolean, default: false },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  },
  { timestamps: true }
);

LeaveTypeSchema.index({ organizationId: 1, code: 1 }, { unique: true });

export const LeaveType = (mongoose.models.LeaveType as mongoose.Model<ILeaveType>) || mongoose.model<ILeaveType>("LeaveType", LeaveTypeSchema);
export default LeaveType;
