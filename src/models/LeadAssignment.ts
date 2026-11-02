import mongoose, { Schema } from "mongoose";

export interface ILeadAssignment extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  productId?: mongoose.Types.ObjectId | null;
  assignedBy: mongoose.Types.ObjectId;
  assignmentMode: "MANUAL" | "EXCEL" | "EQUAL_DISTRIBUTION" | "ROUND_ROBIN" | "PRODUCT_QUOTA";
  quotaRuleId?: mongoose.Types.ObjectId | null;
  assignedAt: Date;
  previousEmployeeId?: mongoose.Types.ObjectId | null;
  reason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const LeadAssignmentSchema = new Schema<ILeadAssignment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignmentMode: {
      type: String,
      enum: ["MANUAL", "EXCEL", "EQUAL_DISTRIBUTION", "ROUND_ROBIN", "PRODUCT_QUOTA"],
      default: "MANUAL",
    },
    quotaRuleId: { type: Schema.Types.ObjectId, ref: "LeadQuota", default: null },
    assignedAt: { type: Date, required: true, default: () => new Date() },
    previousEmployeeId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: null },
  },
  { timestamps: true }
);

LeadAssignmentSchema.index({ leadId: 1, createdAt: -1 });

export const LeadAssignment =
  (mongoose.models.LeadAssignment as mongoose.Model<ILeadAssignment>) ||
  mongoose.model<ILeadAssignment>("LeadAssignment", LeadAssignmentSchema);

export default LeadAssignment;
