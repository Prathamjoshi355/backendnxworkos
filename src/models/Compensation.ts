import mongoose, { Schema } from "mongoose";

export type CompensationEmploymentType = "EMPLOYEE" | "INTERN";
export type CompensationType = "SALARY" | "STIPEND";
export type CompensationPayFrequency = "MONTHLY" | "YEARLY" | "BIWEEKLY";
export type CompensationStatus = "ACTIVE" | "INACTIVE" | "REVISED";
export type SalaryType = "MONTHLY" | "HOURLY";

export interface ICompensationAllowances {
  hra?: number;
  conveyance?: number;
  special?: number;
  medical?: number;
  other?: number;
  [key: string]: any;
}

export interface ICompensationDeductions {
  pf?: number;
  esi?: number;
  tds?: number;
  professionalTax?: number;
  other?: number;
  [key: string]: any;
}

export interface ICompensation extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  employmentType: CompensationEmploymentType;
  compensationType: CompensationType;
  baseAmount: number; // monthly gross or monthly stipend
  currency: string;
  payFrequency: CompensationPayFrequency;
  salaryType?: SalaryType;
  monthlyGrossSalary?: number;
  hourlyRate?: number;
  basicSalary?: number;
  allowances?: ICompensationAllowances;
  deductions?: ICompensationDeductions;
  ctc?: number;
  grossSalary?: number;
  netSalary?: number;
  payrollStartDate?: Date | null;

  // Intern specific fields
  stipendType?: SalaryType;
  monthlyStipend?: number;
  hourlyStipend?: number;
  internshipStartDate?: Date | null;
  internshipEndDate?: Date | null;
  evaluationPeriodMonths?: number | null;
  provisionPeriodStipend?: number | null;
  confirmedStipend?: number | null;
  confirmedStipendEffectiveDate?: Date | null;

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
    payFrequency: { type: String, enum: ["MONTHLY", "YEARLY", "BIWEEKLY"], default: "MONTHLY" },
    salaryType: { type: String, enum: ["MONTHLY", "HOURLY"], default: "MONTHLY" },
    monthlyGrossSalary: { type: Number, default: 0 },
    hourlyRate: { type: Number, default: 0 },
    basicSalary: { type: Number, default: 0 },
    allowances: { type: Schema.Types.Mixed, default: {} },
    deductions: { type: Schema.Types.Mixed, default: {} },
    ctc: { type: Number, default: 0 },
    grossSalary: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    payrollStartDate: { type: Date, default: null },

    stipendType: { type: String, enum: ["MONTHLY", "HOURLY"], default: "MONTHLY" },
    monthlyStipend: { type: Number, default: 0 },
    hourlyStipend: { type: Number, default: 0 },
    internshipStartDate: { type: Date, default: null },
    internshipEndDate: { type: Date, default: null },
    evaluationPeriodMonths: { type: Number, default: null },
    provisionPeriodStipend: { type: Number, default: null },
    confirmedStipend: { type: Number, default: null },
    confirmedStipendEffectiveDate: { type: Date, default: null },

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
