import mongoose, { Schema } from "mongoose";

export type CompensationEmploymentType = "EMPLOYEE" | "INTERN";
export type CompensationType = "SALARY" | "STIPEND";
export type CompensationPayFrequency = "MONTHLY" | "YEARLY";
export type CompensationStatus = "ACTIVE" | "INACTIVE" | "REVISED";

export interface ICompensation extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  employmentType: CompensationEmploymentType;
  compensationType: CompensationType;
  baseAmount: number;
  currency: string;
  payFrequency: CompensationPayFrequency;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  status: CompensationStatus;
  reason?: string | null;
  createdBy: mongoose.Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}

const CompensationSchema = new Schema<ICompensation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    employmentType: { type: String, enum: ["EMPLOYEE", "INTERN"], required: true, index: true },
    compensationType: { type: String, enum: ["SALARY", "STIPEND"], required: true, index: true },
    baseAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    payFrequency: { type: String, enum: ["MONTHLY", "YEARLY"], default: "MONTHLY" },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null },
    status: { type: String, enum: ["ACTIVE", "INACTIVE", "REVISED"], default: "ACTIVE", index: true },
    reason: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

CompensationSchema.index({ userId: 1, effectiveFrom: 1 });
CompensationSchema.index({ organizationId: 1, effectiveFrom: 1 });
CompensationSchema.index({ userId: 1, status: 1 });
CompensationSchema.index({ organizationId: 1, divisionId: 1 });

export const Compensation =
  (mongoose.models.Compensation as mongoose.Model<ICompensation>) ||
  mongoose.model<ICompensation>("Compensation", CompensationSchema);

export default Compensation;
