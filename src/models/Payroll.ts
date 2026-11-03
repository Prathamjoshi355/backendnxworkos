import mongoose, { Schema } from "mongoose";

export type PayrollStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "PAID" | "CANCELLED";
export type PayrollClassification =
  | "FULL_TIME_EMPLOYEE"
  | "PART_TIME_EMPLOYEE"
  | "FULL_TIME_INTERN"
  | "PART_TIME_INTERN";

export interface IPayrollPaymentDetails {
  paymentDate?: Date | null;
  transactionReference?: string | null;
  paymentMode?: "BANK_TRANSFER" | "UPI" | "CHEQUE" | "CASH" | "OTHER" | string | null;
  bankName?: string | null;
  maskedAccountNumber?: string | null;
  notes?: string | null;
}

export interface IPayrollAdjustment {
  adjustmentId?: string;
  reason: string;
  amount: number; // positive for addition, negative for deduction
  adjustedBy: mongoose.Types.ObjectId | string;
  adjustedByName?: string;
  adjustedAt: Date;
}

export interface IPayrollAuditItem {
  action: string;
  performedBy: mongoose.Types.ObjectId | string;
  performedByName?: string;
  timestamp: Date;
  notes?: string;
  metadata?: any;
}

export interface IPayroll extends mongoose.Document {
  payrollId: string; // e.g. PAY-YYMM-NX-EMP-XXXX
  organizationId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  departmentId?: string | null;
  userId: mongoose.Types.ObjectId | string;
  employeeId: string;
  employeeName: string;
  designation?: string | null;
  employmentType: "EMPLOYEE" | "INTERN";
  employmentClassification: PayrollClassification;

  payrollMonth: number; // 1-12
  payrollYear: number; // e.g. 2026
  periodStartDate: Date;
  periodEndDate: Date;
  targetPaymentDate: Date;

  joiningDate?: Date | null;
  payrollEligibilityDate?: Date | null;
  isProrated: boolean;
  totalCalendarDaysInMonth: number;
  proratedDays?: number | null;

  // Attendance metrics
  scheduledWorkingDays: number;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  approvedPaidLeaveDays: number;
  unpaidLeaveDays: number;
  unapprovedAbsenceDays: number;
  weeklyOffs: number;
  governmentHolidays: number;
  eligiblePayableDays: number;

  // Salary / Stipend & Breakdowns
  baseSalaryOrStipend: number;
  proratedBaseSalaryOrStipend: number;
  allowances: Record<string, number>;
  totalAllowances: number;
  grossPay: number;

  statutoryDeductions: {
    pf?: number;
    esi?: number;
    tds?: number;
    professionalTax?: number;
    other?: number;
    [key: string]: any;
  };
  lossOfPayDeductions: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  daysInMonth?: number;
  monthlyGrossSalary?: number;
  basicSalary?: number;
  grossPayable?: number;
  netPayable?: number;

  status: PayrollStatus;
  reviewedBy?: mongoose.Types.ObjectId | string | null;
  reviewedAt?: Date | null;
  approvedBy?: mongoose.Types.ObjectId | string | null;
  approvedAt?: Date | null;
  paidBy?: mongoose.Types.ObjectId | string | null;
  paidAt?: Date | null;
  paymentDetails?: IPayrollPaymentDetails;

  payslipGeneratedAt?: Date | null;
  payslipDocumentId?: string | null;

  adjustments: IPayrollAdjustment[];
  auditHistory: IPayrollAuditItem[];

  createdAt: Date;
  updatedAt: Date;
}

const PayrollSchema = new Schema<IPayroll>(
  {
    payrollId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    departmentId: { type: String, default: null, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employeeId: { type: String, required: true, index: true },
    employeeName: { type: String, required: true },
    designation: { type: String, default: null },
    employmentType: { type: String, enum: ["EMPLOYEE", "INTERN"], required: true, index: true },
    employmentClassification: {
      type: String,
      enum: ["FULL_TIME_EMPLOYEE", "PART_TIME_EMPLOYEE", "FULL_TIME_INTERN", "PART_TIME_INTERN"],
      required: true,
      index: true,
    },

    payrollMonth: { type: Number, required: true, min: 1, max: 12, index: true },
    payrollYear: { type: Number, required: true, index: true },
    periodStartDate: { type: Date, required: true },
    periodEndDate: { type: Date, required: true },
    targetPaymentDate: { type: Date, required: true },

    joiningDate: { type: Date, default: null },
    payrollEligibilityDate: { type: Date, default: null },
    isProrated: { type: Boolean, default: false },
    totalCalendarDaysInMonth: { type: Number, required: true, default: 30 },
    proratedDays: { type: Number, default: null },

    scheduledWorkingDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    lateDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    approvedPaidLeaveDays: { type: Number, default: 0 },
    unpaidLeaveDays: { type: Number, default: 0 },
    unapprovedAbsenceDays: { type: Number, default: 0 },
    weeklyOffs: { type: Number, default: 0 },
    governmentHolidays: { type: Number, default: 0 },
    eligiblePayableDays: { type: Number, default: 0 },

    baseSalaryOrStipend: { type: Number, required: true, default: 0 },
    proratedBaseSalaryOrStipend: { type: Number, required: true, default: 0 },
    allowances: { type: Schema.Types.Mixed, default: {} },
    totalAllowances: { type: Number, default: 0 },
    grossPay: { type: Number, required: true, default: 0 },

    statutoryDeductions: { type: Schema.Types.Mixed, default: {} },
    lossOfPayDeductions: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netPay: { type: Number, required: true, default: 0 },
    daysInMonth: { type: Number, default: null },
    monthlyGrossSalary: { type: Number, default: null },
    basicSalary: { type: Number, default: null },
    grossPayable: { type: Number, default: null },
    netPayable: { type: Number, default: null },

    status: {
      type: String,
      enum: ["DRAFT", "UNDER_REVIEW", "APPROVED", "PAID", "CANCELLED"],
      default: "DRAFT",
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    paidAt: { type: Date, default: null },
    paymentDetails: {
      paymentDate: { type: Date, default: null },
      transactionReference: { type: String, default: null },
      paymentMode: { type: String, default: null },
      bankName: { type: String, default: null },
      maskedAccountNumber: { type: String, default: null },
      notes: { type: String, default: null },
    },

    payslipGeneratedAt: { type: Date, default: null },
    payslipDocumentId: { type: String, default: null },

    adjustments: [
      {
        adjustmentId: { type: String, default: null },
        reason: { type: String, required: true },
        amount: { type: Number, required: true },
        adjustedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        adjustedByName: { type: String, default: null },
        adjustedAt: { type: Date, default: Date.now },
      },
    ],
    auditHistory: [
      {
        action: { type: String, required: true },
        performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        performedByName: { type: String, default: null },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String, default: null },
        metadata: { type: Schema.Types.Mixed, default: null },
      },
    ],
  },
  { timestamps: true }
);

PayrollSchema.index({ organizationId: 1, userId: 1, payrollYear: 1, payrollMonth: 1 }, { unique: true });
PayrollSchema.index({ organizationId: 1, payrollYear: 1, payrollMonth: 1, status: 1 });
PayrollSchema.index({ organizationId: 1, employmentClassification: 1, payrollYear: 1, payrollMonth: 1 });
PayrollSchema.index({ organizationId: 1, employmentType: 1, payrollYear: 1, payrollMonth: 1 });
PayrollSchema.index({ organizationId: 1, divisionId: 1, payrollYear: 1, payrollMonth: 1 });
PayrollSchema.index({ organizationId: 1, departmentId: 1, payrollYear: 1, payrollMonth: 1 });

export const Payroll =
  (mongoose.models.Payroll as mongoose.Model<IPayroll>) ||
  mongoose.model<IPayroll>("Payroll", PayrollSchema);

export default Payroll;
