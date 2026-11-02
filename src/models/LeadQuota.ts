import mongoose, { Schema } from "mongoose";

export interface ILeadQuota extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  departmentId?: string | null;
  teamId?: string | null;
  maxLeads: number;
  assignedCount: number;
  period: "MONTHLY" | "WEEKLY" | "ALL_TIME";
  status: "ACTIVE" | "INACTIVE";
  createdAt?: Date;
  updatedAt?: Date;
}

const LeadQuotaSchema = new Schema<ILeadQuota>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    departmentId: { type: String, default: null },
    teamId: { type: String, default: null },
    maxLeads: { type: Number, required: true, default: 0 },
    assignedCount: { type: Number, default: 0 },
    period: { type: String, enum: ["MONTHLY", "WEEKLY", "ALL_TIME"], default: "MONTHLY" },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

LeadQuotaSchema.index({ organizationId: 1, productId: 1, employeeId: 1 }, { unique: true });

export const LeadQuota =
  (mongoose.models.LeadQuota as mongoose.Model<ILeadQuota>) ||
  mongoose.model<ILeadQuota>("LeadQuota", LeadQuotaSchema);

export default LeadQuota;
