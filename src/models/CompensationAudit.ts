import mongoose, { Schema } from "mongoose";

export type CompensationAuditAction = "CREATED" | "REVISED" | "ACTIVATED" | "DEACTIVATED";

export interface ICompensationAudit extends mongoose.Document {
  compensationId: mongoose.Types.ObjectId | string;
  userId: mongoose.Types.ObjectId | string;
  action: CompensationAuditAction;
  previousAmount?: number | null;
  newAmount?: number | null;
  previousType?: string | null;
  newType?: string | null;
  effectiveFrom?: Date | null;
  changedBy: mongoose.Types.ObjectId | string;
  reason?: string | null;
  createdAt: Date;
}

const CompensationAuditSchema = new Schema<ICompensationAudit>(
  {
    compensationId: { type: Schema.Types.ObjectId, ref: "Compensation", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, enum: ["CREATED", "REVISED", "ACTIVATED", "DEACTIVATED"], required: true, index: true },
    previousAmount: { type: Number, default: null },
    newAmount: { type: Number, default: null },
    previousType: { type: String, default: null },
    newType: { type: String, default: null },
    effectiveFrom: { type: Date, default: null },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CompensationAuditSchema.index({ userId: 1, createdAt: -1 });
CompensationAuditSchema.index({ compensationId: 1, createdAt: -1 });

export const CompensationAudit =
  (mongoose.models.CompensationAudit as mongoose.Model<ICompensationAudit>) ||
  mongoose.model<ICompensationAudit>("CompensationAudit", CompensationAuditSchema);

export default CompensationAudit;
