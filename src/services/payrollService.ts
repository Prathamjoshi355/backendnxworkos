import mongoose from "mongoose";
import { Payroll, IPayroll, PayrollStatus, PayrollClassification } from "../models/Payroll";
import { User } from "../models/User";
import { Attendance } from "../models/Attendance";
import { Leave } from "../models/Leave";
import { Compensation } from "../models/Compensation";
import { isDateHoliday } from "./holidayService";
import { recordAuditLog } from "./auditLogService";
import { getManagementScope } from "../utils/scopeHelper";

export interface GeneratePayrollOptions {
  divisionId?: string;
  departmentId?: string;
  employmentType?: "EMPLOYEE" | "INTERN";
  employmentClassification?: PayrollClassification;
  forceRecalculate?: boolean;
  overwriteDraft?: boolean;
  userIds?: string[];
}

export interface PayrollFilters {
  payrollMonth?: number;
  payrollYear?: number;
  departmentId?: string;
  divisionId?: string;
  employmentType?: "EMPLOYEE" | "INTERN";
  employmentClassification?: string;
  status?: PayrollStatus;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Returns number of calendar days in a month.
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Helper to mask sensitive bank account numbers.
 * Displays only the last 4 digits (e.g., "XXXX-XXXX-1234").
 */
export function maskBankAccountNumber(accountNo?: string | null): string {
  if (!accountNo) return "N/A";
  const clean = accountNo.trim();
  if (clean.length <= 4) return clean;
  return `XXXX-XXXX-${clean.slice(-4)}`;
}

/**
 * Centralized monthly payroll generation for Employees and Interns.
 * Computes scheduled working days, attendance, paid/unpaid leaves, weekly offs, holidays,
 * prorated mid-month joining, and gross/net pay.
 */
export async function generateMonthlyPayroll(
  organizationId: mongoose.Types.ObjectId | string,
  month: number,
  year: number,
  options: GeneratePayrollOptions = {},
  currentUser: any
): Promise<{
  generatedCount: number;
  existingCount: number;
  payrolls: IPayroll[];
}> {
  if (month < 1 || month > 12) {
    throw new Error("INVALID_PAYROLL_MONTH: Month must be between 1 and 12.");
  }

  const daysInMonth = getDaysInMonth(year, month);
  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, month - 1, daysInMonth, 23, 59, 59, 999));
  const targetPaymentDay = Math.min(30, daysInMonth);
  const targetPaymentDate = new Date(Date.UTC(year, month - 1, targetPaymentDay, 0, 0, 0, 0));

  // Query eligible active employees & interns
  const userQuery: any = {
    organizationId,
    status: { $in: ["ACTIVE", "CONFIRMED", "PROBATION", "ON_LEAVE"] },
    employmentStatus: { $in: ["ACTIVE", "CONFIRMED", "PROBATION", "ON_LEAVE"] },
  };

  if (options.divisionId) userQuery.divisionId = options.divisionId;
  if (options.departmentId) userQuery.departmentId = options.departmentId;
  if (options.employmentType) userQuery.employmentType = options.employmentType;
  if (options.employmentClassification) userQuery.employmentClassification = options.employmentClassification;
  if (options.userIds && options.userIds.length > 0) userQuery._id = { $in: options.userIds };

  // Filter out platform-only accounts without employee record
  const eligibleUsers = await User.find(userQuery).lean();

  let generatedCount = 0;
  let existingCount = 0;
  const payrolls: IPayroll[] = [];

  for (const user of eligibleUsers) {
    if (!user.employeeId) continue; // skip non-employment platform accounts
    if (user.role === "SUPER_ADMIN" && !user.joiningDate) continue; // skip pure platform admins

    // Duplicate check
    const existing = await Payroll.findOne({
      organizationId,
      userId: user._id,
      payrollYear: year,
      payrollMonth: month,
    });

    const canOverwrite = Boolean(options.overwriteDraft || options.forceRecalculate);
    if (existing) {
      if (existing.status !== "DRAFT" || !canOverwrite) {
        existingCount++;
        payrolls.push(existing);
        continue;
      }
      // If overwrite on DRAFT, delete existing draft to regenerate
      await Payroll.findByIdAndDelete(existing._id);
    }

    // Determine Classification
    const isIntern =
      user.employmentType === "INTERN" ||
      user.role === "INTERN" ||
      user.employmentClassification === "FULL_TIME_INTERN" ||
      user.employmentClassification === "PART_TIME_INTERN";

    const classification: PayrollClassification =
      (user.employmentClassification as PayrollClassification) ||
      (isIntern ? "FULL_TIME_INTERN" : "FULL_TIME_EMPLOYEE");

    // Fetch active Compensation
    const comp = await Compensation.findOne({
      userId: user._id,
      status: "ACTIVE",
    }).sort({ effectiveFrom: -1 }).lean();

    const baseAmount = comp?.baseAmount || (isIntern ? (user.confirmedStipend || user.provisionStipend || 0) : 0);

    // Evaluate Mid-Month Joining Proration
    const joiningDate = user.joiningDate || user.internshipStartDate || (user as any).createdAt;
    let isProrated = false;
    let employeePeriodStart = new Date(periodStart);
    let proratedDays = daysInMonth;

    if (joiningDate) {
      const joinObj = new Date(joiningDate);
      if (joinObj > periodStart && joinObj <= periodEnd) {
        isProrated = true;
        employeePeriodStart = new Date(joinObj);
        employeePeriodStart.setHours(0, 0, 0, 0);
        proratedDays = Math.max(1, daysInMonth - joinObj.getDate() + 1);
      }
    }

    // Fetch Attendance records in the period
    const attendanceRecords = await Attendance.find({
      userId: user._id,
      date: { $gte: employeePeriodStart, $lte: periodEnd },
    }).lean();

    let presentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let approvedPaidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let unapprovedAbsenceDays = 0;
    let weeklyOffs = 0;
    let governmentHolidays = 0;

    for (const att of attendanceRecords) {
      switch (att.attendanceStatus) {
        case "PRESENT":
          presentDays++;
          break;
        case "LATE":
          lateDays++;
          break;
        case "HALF_DAY":
          halfDays++;
          break;
        case "ON_LEAVE":
          approvedPaidLeaveDays++;
          break;
        case "UNPAID_LEAVE":
          unpaidLeaveDays++;
          break;
        case "WEEKLY_OFF":
          weeklyOffs++;
          break;
        case "HOLIDAY":
          governmentHolidays++;
          break;
        case "ABSENT":
          unapprovedAbsenceDays++;
          break;
        default:
          break;
      }
    }

    // Scheduled working days in the employee's period
    let scheduledWorkingDays = 0;
    const cur = new Date(employeePeriodStart);
    cur.setHours(0, 0, 0, 0);

    while (cur <= periodEnd) {
      const dow = cur.getDay(); // 0 = Sun, 6 = Sat
      const isHoliday = await isDateHoliday(organizationId, cur);

      if (!isHoliday) {
        if (isIntern && dow !== 6) {
          scheduledWorkingDays++;
        } else if (!isIntern && dow !== 0) {
          scheduledWorkingDays++;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    // Eligible Payable Days
    // Paid leave, weekly offs, and declared holidays do NOT reduce payable days!
    const payableDaysSum =
      presentDays +
      lateDays +
      halfDays * 0.5 +
      approvedPaidLeaveDays +
      weeklyOffs +
      governmentHolidays;

    const maxDays = isProrated ? proratedDays : daysInMonth;
    // If attendance is tracked, use payableDaysSum capped at maxDays; if no attendance recorded yet, default to scheduled
    const eligiblePayableDays = attendanceRecords.length > 0 ? Math.min(maxDays, payableDaysSum) : maxDays;

    // Proration & Loss of Pay Calculations
    const prorationRatio = isProrated ? proratedDays / daysInMonth : 1.0;
    const payableRatio = daysInMonth > 0 ? eligiblePayableDays / daysInMonth : 1.0;

    const proratedBase = Math.round(baseAmount * payableRatio);

    // Allowances
    const allowancesMap = comp?.allowances || {};
    let totalAllowances = 0;
    for (const key of Object.keys(allowancesMap)) {
      const val = Number(allowancesMap[key]) || 0;
      totalAllowances += Math.round(val * prorationRatio);
    }

    const grossPay = proratedBase + totalAllowances;

    // Statutory and other deductions
    const deductionsMap = comp?.deductions || {};
    let statutoryDeductionsTotal = 0;
    for (const key of Object.keys(deductionsMap)) {
      statutoryDeductionsTotal += Number(deductionsMap[key]) || 0;
    }

    // Loss of Pay (LOP) deduction (already reflected in prorated base, avoid double deductions)
    const lossOfPayDays = unpaidLeaveDays + unapprovedAbsenceDays + halfDays * 0.5;
    const lossOfPayDeductions = Math.round((baseAmount / daysInMonth) * lossOfPayDays);

    const otherDeductions = 0;
    const totalDeductions = statutoryDeductionsTotal + otherDeductions;
    const netPay = Math.max(0, grossPay - totalDeductions);

    const payrollId = `PAY-${year}${String(month).padStart(2, "0")}-${user.employeeId}`;

    const newPayroll = await Payroll.create({
      payrollId,
      organizationId,
      divisionId: user.divisionId || null,
      departmentId: user.departmentId || null,
      userId: user._id,
      employeeId: user.employeeId,
      employeeName: user.fullName,
      designation: user.designation || null,
      employmentType: isIntern ? "INTERN" : "EMPLOYEE",
      employmentClassification: classification,
      payrollMonth: month,
      payrollYear: year,
      periodStartDate: employeePeriodStart,
      periodEndDate: periodEnd,
      targetPaymentDate,
      joiningDate: joiningDate ? new Date(joiningDate) : null,
      payrollEligibilityDate: employeePeriodStart,
      isProrated,
      totalCalendarDaysInMonth: daysInMonth,
      proratedDays: isProrated ? proratedDays : null,

      scheduledWorkingDays,
      presentDays,
      lateDays,
      halfDays,
      approvedPaidLeaveDays,
      unpaidLeaveDays,
      unapprovedAbsenceDays,
      weeklyOffs,
      governmentHolidays,
      eligiblePayableDays,

      baseSalaryOrStipend: baseAmount,
      proratedBaseSalaryOrStipend: proratedBase,
      allowances: allowancesMap,
      totalAllowances,
      grossPay,

      statutoryDeductions: deductionsMap,
      lossOfPayDeductions,
      otherDeductions,
      totalDeductions,
      netPay,
      daysInMonth,
      monthlyGrossSalary: baseAmount,
      basicSalary: comp?.basicSalary || (isIntern ? 0 : Math.round(baseAmount * 0.5)),
      grossPayable: grossPay,
      netPayable: netPay,

      status: "DRAFT",
      auditHistory: [
        {
          action: "PAYROLL_GENERATED",
          performedBy: currentUser._id,
          performedByName: currentUser.fullName || currentUser.email,
          timestamp: new Date(),
          notes: `Generated ${classification} payroll for period ${month}/${year}. Gross: ₹${grossPay}, Net: ₹${netPay}`,
        },
      ],
    });

    generatedCount++;
    payrolls.push(newPayroll);
  }

  // Record platform audit log
  await recordAuditLog({
    organizationId: String(organizationId),
    actorId: String(currentUser._id),
    actorRole: currentUser.role,
    action: "MONTHLY_PAYROLL_GENERATED",
    entityType: "PAYROLL",
    summary: `Generated monthly payroll for ${month}/${year}. Generated: ${generatedCount}, Existing: ${existingCount}`,
    metadata: { month, year, generatedCount, existingCount },
  }).catch(() => {});

  if (existingCount > 0 && generatedCount === 0 && !options.overwriteDraft && !options.forceRecalculate) {
    throw new Error("ALREADY_EXISTS: Payroll records for this period already exist. Use overwriteDraft or forceRecalculate to regenerate.");
  }

  return { generatedCount, existingCount, payrolls };
}

/**
 * List payroll records with RBAC scoping and multi-dimensional filters.
 */
export async function listPayrolls(
  organizationId: mongoose.Types.ObjectId | string,
  filters: PayrollFilters = {},
  currentUser: any
): Promise<{ total: number; page: number; limit: number; items: IPayroll[] }> {
  const query: any = { organizationId };

  // RBAC scope enforcement (Section 10)
  if (currentUser.role === "EMPLOYEE" || currentUser.role === "INTERN") {
    query.userId = currentUser._id;
  } else if (currentUser.role === "DIVISION_ADMIN") {
    if (!currentUser.divisionId) {
      return { total: 0, page: 1, limit: filters.limit || 50, items: [] };
    }
    query.divisionId = currentUser.divisionId;
  } else if (currentUser.role === "MANAGER" || currentUser.role === "TEAM_LEADER") {
    const scope = await getManagementScope(currentUser);
    query.userId = { $in: scope.scopedUserIds };
  } else if (
    currentUser.role !== "SUPER_ADMIN" &&
    currentUser.role !== "ADMIN" &&
    currentUser.role !== "HR"
  ) {
    throw new Error("FORBIDDEN: You do not have permission to view payroll records.");
  }

  if (filters.payrollMonth) query.payrollMonth = Number(filters.payrollMonth);
  if (filters.payrollYear) query.payrollYear = Number(filters.payrollYear);
  if (filters.departmentId) query.departmentId = filters.departmentId;
  if (filters.divisionId && currentUser.role !== "DIVISION_ADMIN") query.divisionId = filters.divisionId;
  if (filters.employmentType) query.employmentType = filters.employmentType;
  if (filters.employmentClassification) query.employmentClassification = filters.employmentClassification;
  if (filters.status) query.status = filters.status;

  if (filters.search) {
    const term = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ employeeName: term }, { employeeId: term }, { payrollId: term }];
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.max(1, Number(filters.limit) || 50);
  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    Payroll.countDocuments(query),
    Payroll.find(query).sort({ employeeId: 1 }).skip(skip).limit(limit).lean(),
  ]);

  return { total, page, limit, items: items as IPayroll[] };
}

/**
 * Get payroll record by ID with authorization check.
 */
export async function getPayrollById(
  payrollIdOrDocId: string,
  currentUser: any
): Promise<IPayroll> {
  const query = mongoose.isValidObjectId(payrollIdOrDocId)
    ? { _id: payrollIdOrDocId }
    : { payrollId: payrollIdOrDocId };

  const payroll = await Payroll.findOne(query).lean();
  if (!payroll) {
    throw new Error("PAYROLL_NOT_FOUND: Payroll record does not exist.");
  }

  // Authorization check
  if (currentUser.role === "EMPLOYEE" || currentUser.role === "INTERN") {
    if (String(payroll.userId) !== String(currentUser._id)) {
      throw new Error("FORBIDDEN: You can only view your own payroll records.");
    }
  } else if (currentUser.role === "DIVISION_ADMIN") {
    if (String(payroll.divisionId) !== String(currentUser.divisionId)) {
      throw new Error("FORBIDDEN: You can only access payroll within your assigned division.");
    }
  }

  return payroll as IPayroll;
}

/**
 * Transition payroll status (DRAFT -> UNDER_REVIEW -> APPROVED).
 */
export async function updatePayrollStatus(
  payrollId: string,
  targetStatus: PayrollStatus,
  notes?: string,
  currentUser?: any
): Promise<IPayroll> {
  const allowedRoles = ["SUPER_ADMIN", "ADMIN", "HR"];
  if (currentUser && !allowedRoles.includes(currentUser.role)) {
    throw new Error("FORBIDDEN: Only authorized HR or Admin personnel can review and approve payroll.");
  }

  const payroll = await Payroll.findById(payrollId);
  if (!payroll) {
    throw new Error("PAYROLL_NOT_FOUND");
  }

  if (payroll.status === "PAID" && targetStatus !== "PAID") {
    throw new Error("IMMUTABLE_PAID_PAYROLL: Paid payroll records cannot be reverted. Create an adjustment instead.");
  }

  const oldStatus = payroll.status;
  payroll.status = targetStatus;

  if (targetStatus === "UNDER_REVIEW") {
    payroll.reviewedBy = currentUser?._id;
    payroll.reviewedAt = new Date();
  } else if (targetStatus === "APPROVED") {
    payroll.approvedBy = currentUser?._id;
    payroll.approvedAt = new Date();
  }

  payroll.auditHistory.push({
    action: `STATUS_CHANGED_TO_${targetStatus}`,
    performedBy: currentUser?._id || new mongoose.Types.ObjectId(),
    performedByName: currentUser?.fullName || currentUser?.email || "System",
    timestamp: new Date(),
    notes: notes || `Payroll status updated from ${oldStatus} to ${targetStatus}`,
  });

  await payroll.save();
  return payroll;
}

/**
 * Confirm actual payment and mark payroll as PAID.
 * Enforces: A payroll record must not become PAID merely because it has been approved.
 */
export async function confirmPayrollPayment(
  payrollId: string,
  paymentDetails: {
    paymentDate: Date | string;
    transactionReference: string;
    paymentMode?: string;
    bankName?: string;
    notes?: string;
  },
  currentUser: any
): Promise<IPayroll> {
  const allowedRoles = ["SUPER_ADMIN", "ADMIN", "HR"];
  if (!allowedRoles.includes(currentUser.role)) {
    throw new Error("FORBIDDEN: Only authorized HR or Admin personnel can confirm payment.");
  }

  if (!paymentDetails.transactionReference || paymentDetails.transactionReference.trim().length === 0) {
    throw new Error("PAYMENT_REFERENCE_REQUIRED: Transaction reference number is required to confirm payment.");
  }

  const payroll = await Payroll.findById(payrollId);
  if (!payroll) {
    throw new Error("PAYROLL_NOT_FOUND");
  }

  if (payroll.status === "PAID") {
    throw new Error("ALREADY_PAID: Payroll is already marked as paid.");
  }

  payroll.status = "PAID";
  payroll.paidBy = currentUser._id;
  payroll.paidAt = new Date();
  payroll.paymentDetails = {
    paymentDate: new Date(paymentDetails.paymentDate),
    transactionReference: paymentDetails.transactionReference.trim(),
    paymentMode: paymentDetails.paymentMode || "BANK_TRANSFER",
    bankName: paymentDetails.bankName || null,
    notes: paymentDetails.notes || null,
  };

  payroll.auditHistory.push({
    action: "PAYMENT_CONFIRMED",
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    timestamp: new Date(),
    notes: `Payment confirmed. Ref: ${paymentDetails.transactionReference.trim()}, Mode: ${payroll.paymentDetails.paymentMode}`,
  });

  await payroll.save();

  await recordAuditLog({
    organizationId: String(payroll.organizationId),
    actorId: String(currentUser._id),
    actorRole: currentUser.role,
    action: "PAYROLL_PAYMENT_CONFIRMED",
    entityType: "PAYROLL",
    entityId: String(payroll._id),
    summary: `Confirmed payment of ₹${payroll.netPay} for ${payroll.employeeName} (${payroll.employeeId})`,
    metadata: { payrollId: payroll.payrollId, netPay: payroll.netPay, ref: paymentDetails.transactionReference },
  }).catch(() => {});

  return payroll;
}

/**
 * HR/Admin Payroll Dashboard Metrics Aggregator (Section 8).
 */
export async function getPayrollDashboardMetrics(
  organizationId: mongoose.Types.ObjectId | string,
  month: number,
  year: number,
  filters: { divisionId?: string; departmentId?: string } = {},
  currentUser: any
) {
  const userBaseQuery: any = {
    organizationId,
    status: { $in: ["ACTIVE", "CONFIRMED", "PROBATION", "ON_LEAVE"] },
  };
  if (filters.divisionId) userBaseQuery.divisionId = filters.divisionId;
  if (filters.departmentId) userBaseQuery.departmentId = filters.departmentId;

  // Headcount counts
  const allUsers = await User.find(userBaseQuery)
    .select("_id role employmentType employmentClassification employeeId joiningDate")
    .lean();

  // Exclude pure platform admins without employee IDs
  const activeEmployments = allUsers.filter(
    (u) => Boolean(u.employeeId) && !(u.role === "SUPER_ADMIN" && !u.joiningDate)
  );

  const totalActiveEmployees = activeEmployments.filter(
    (u) => u.employmentType === "EMPLOYEE" || u.role === "EMPLOYEE"
  ).length;

  const totalActiveInterns = activeEmployments.filter(
    (u) => u.employmentType === "INTERN" || u.role === "INTERN"
  ).length;

  const fullTimeEmployees = activeEmployments.filter(
    (u) =>
      u.employmentClassification === "FULL_TIME_EMPLOYEE" ||
      (!u.employmentClassification && u.employmentType !== "INTERN" && u.role !== "INTERN")
  ).length;

  const partTimeEmployees = activeEmployments.filter(
    (u) => u.employmentClassification === "PART_TIME_EMPLOYEE"
  ).length;

  const fullTimeInterns = activeEmployments.filter(
    (u) =>
      u.employmentClassification === "FULL_TIME_INTERN" ||
      (!u.employmentClassification && (u.employmentType === "INTERN" || u.role === "INTERN"))
  ).length;

  const partTimeInterns = activeEmployments.filter(
    (u) => u.employmentClassification === "PART_TIME_INTERN"
  ).length;

  // Payroll aggregate metrics
  const payrollQuery: any = {
    organizationId,
    payrollMonth: month,
    payrollYear: year,
  };
  if (filters.divisionId) payrollQuery.divisionId = filters.divisionId;
  if (filters.departmentId) payrollQuery.departmentId = filters.departmentId;

  const payrolls = await Payroll.find(payrollQuery).lean();

  let pendingApprovals = 0;
  let approvedPayroll = 0;
  let paidPayroll = 0;
  let unpaidPayroll = 0;
  let totalMonthlyGrossPayroll = 0;
  let totalMonthlyStipend = 0;
  let totalDeductions = 0;
  let totalNetPayable = 0;

  for (const p of payrolls) {
    if (p.status === "DRAFT" || p.status === "UNDER_REVIEW") pendingApprovals++;
    if (p.status === "APPROVED") approvedPayroll++;
    if (p.status === "PAID") paidPayroll++;
    if (p.status !== "PAID" && p.status !== "CANCELLED") unpaidPayroll++;

    if (p.employmentType === "INTERN") {
      totalMonthlyStipend += p.grossPay;
    } else {
      totalMonthlyGrossPayroll += p.grossPay;
    }
    totalDeductions += p.totalDeductions;
    totalNetPayable += p.netPay;
  }

  return {
    month,
    year,
    headcount: {
      totalActive: totalActiveEmployees + totalActiveInterns,
      totalActiveEmployees,
      totalActiveInterns,
      fullTimeEmployees,
      partTimeEmployees,
      fullTimeInterns,
      partTimeInterns,
      employeesEligibleForCurrentPayroll: totalActiveEmployees,
      internsEligibleForCurrentPayroll: totalActiveInterns,
    },
    payrollCounts: {
      totalRecords: payrolls.length,
      draft: payrolls.filter((p) => p.status === "DRAFT").length,
      underReview: payrolls.filter((p) => p.status === "UNDER_REVIEW").length,
      approved: approvedPayroll,
      paid: paidPayroll,
    },
    payrollStatusCounts: {
      totalGenerated: payrolls.length,
      pendingApprovals,
      approvedPayroll,
      paidPayroll,
      unpaidPayroll,
    },
    financialSummary: {
      totalGross: totalMonthlyGrossPayroll + totalMonthlyStipend,
      totalEmployeeGross: totalMonthlyGrossPayroll,
      totalInternStipend: totalMonthlyStipend,
      totalDeductions,
      totalNetPayable,
      totalPaidAmount: payrolls
        .filter((p) => p.status === "PAID")
        .reduce((sum, p) => sum + p.netPay, 0),
      totalPendingAmount: payrolls
        .filter((p) => p.status !== "PAID")
        .reduce((sum, p) => sum + p.netPay, 0),
    },
    financialTotals: {
      totalMonthlyGrossPayroll,
      totalMonthlyStipend,
      totalDeductions,
      totalNetPayable,
    },
  };
}

/**
 * Excel / XML-Spreadsheet Payroll Register and Summary Export (Section 9).
 * Generates an Excel workbook with:
 * - Sheet 1: Payroll Register (with masked account details)
 * - Sheet 2: Summary Sheet (totals)
 */
export async function exportPayrollExcel(
  organizationId: mongoose.Types.ObjectId | string,
  month: number,
  year: number,
  filters: PayrollFilters = {},
  currentUser: any
): Promise<{ filename: string; xmlContent: string }> {
  const result = await listPayrolls(organizationId, { ...filters, payrollMonth: month, payrollYear: year, limit: 10000 }, currentUser);
  const items = result.items;

  let totalEmployeeGross = 0;
  let totalInternStipend = 0;
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalPaid = 0;
  let totalPending = 0;

  for (const item of items) {
    if (item.employmentType === "INTERN") {
      totalInternStipend += item.grossPay;
    } else {
      totalEmployeeGross += item.grossPay;
    }
    totalGross += item.grossPay;
    totalDeductions += item.totalDeductions;
    totalNet += item.netPay;
    if (item.status === "PAID") {
      totalPaid += item.netPay;
    } else {
      totalPending += item.netPay;
    }
  }

  const escapeXml = (s: any) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const registerRows = items
    .map(
      (p) => `<Row>
      <Cell><Data ss:Type="String">${escapeXml(p.employeeId)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.employeeName)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.employmentClassification)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.departmentId || "General")}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.divisionId || "Central")}</Data></Cell>
      <Cell><Data ss:Type="String">${p.payrollMonth}/${p.payrollYear}</Data></Cell>
      <Cell><Data ss:Type="String">${p.joiningDate ? new Date(p.joiningDate).toISOString().split("T")[0] : "N/A"}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.scheduledWorkingDays}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.presentDays + p.lateDays}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.approvedPaidLeaveDays}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.unpaidLeaveDays}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.unapprovedAbsenceDays}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.weeklyOffs}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.governmentHolidays}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.eligiblePayableDays}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.baseSalaryOrStipend}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.totalAllowances}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.totalDeductions}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.grossPay}</Data></Cell>
      <Cell><Data ss:Type="Number">${p.netPay}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.status)}</Data></Cell>
      <Cell><Data ss:Type="String">${p.paymentDetails?.paymentDate ? new Date(p.paymentDetails.paymentDate).toISOString().split("T")[0] : "N/A"}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.paymentDetails?.transactionReference || "N/A")}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(maskBankAccountNumber(p.paymentDetails?.maskedAccountNumber))}</Data></Cell>
    </Row>`
    )
    .join("\n");

  const xmlContent = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E3A8A" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="SubHeader">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Bold">
   <Font ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Payroll Register">
  <Table>
   <Row ss:StyleID="Header">
    <Cell><Data ss:Type="String">Employee ID</Data></Cell>
    <Cell><Data ss:Type="String">Employee Name</Data></Cell>
    <Cell><Data ss:Type="String">Classification</Data></Cell>
    <Cell><Data ss:Type="String">Department</Data></Cell>
    <Cell><Data ss:Type="String">Division</Data></Cell>
    <Cell><Data ss:Type="String">Payroll Month</Data></Cell>
    <Cell><Data ss:Type="String">Joining Date</Data></Cell>
    <Cell><Data ss:Type="String">Scheduled Days</Data></Cell>
    <Cell><Data ss:Type="String">Present Days</Data></Cell>
    <Cell><Data ss:Type="String">Paid Leave</Data></Cell>
    <Cell><Data ss:Type="String">Unpaid Leave</Data></Cell>
    <Cell><Data ss:Type="String">Absence Days</Data></Cell>
    <Cell><Data ss:Type="String">Weekly Offs</Data></Cell>
    <Cell><Data ss:Type="String">Holidays</Data></Cell>
    <Cell><Data ss:Type="String">Payable Days</Data></Cell>
    <Cell><Data ss:Type="String">Basic / Stipend</Data></Cell>
    <Cell><Data ss:Type="String">Allowances</Data></Cell>
    <Cell><Data ss:Type="String">Deductions</Data></Cell>
    <Cell><Data ss:Type="String">Gross Pay</Data></Cell>
    <Cell><Data ss:Type="String">Net Pay</Data></Cell>
    <Cell><Data ss:Type="String">Status</Data></Cell>
    <Cell><Data ss:Type="String">Payment Date</Data></Cell>
    <Cell><Data ss:Type="String">Payment Reference</Data></Cell>
    <Cell><Data ss:Type="String">Masked Bank Account</Data></Cell>
   </Row>
   ${registerRows}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Summary">
  <Table>
   <Row ss:StyleID="Header">
    <Cell><Data ss:Type="String">Company: NEXISPARKX PRIVATE LIMITED (CIN: U62099MP2026PTC084748)</Data></Cell>
    <Cell><Data ss:Type="String">Payroll Period: ${month}/${year}</Data></Cell>
   </Row>
   <Row ss:StyleID="SubHeader">
    <Cell><Data ss:Type="String">Metric</Data></Cell>
    <Cell><Data ss:Type="String">Amount (INR)</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Bold"><Data ss:Type="String">Total Employee Payroll</Data></Cell>
    <Cell><Data ss:Type="Number">${totalEmployeeGross}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Bold"><Data ss:Type="String">Total Intern Stipend</Data></Cell>
    <Cell><Data ss:Type="Number">${totalInternStipend}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Bold"><Data ss:Type="String">Total Gross Pay</Data></Cell>
    <Cell><Data ss:Type="Number">${totalGross}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Bold"><Data ss:Type="String">Total Deductions</Data></Cell>
    <Cell><Data ss:Type="Number">${totalDeductions}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Bold"><Data ss:Type="String">Total Net Payable</Data></Cell>
    <Cell><Data ss:Type="Number">${totalNet}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Bold"><Data ss:Type="String">Total Paid</Data></Cell>
    <Cell><Data ss:Type="Number">${totalPaid}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Bold"><Data ss:Type="String">Total Pending</Data></Cell>
    <Cell><Data ss:Type="Number">${totalPending}</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;

  const filename = `Payroll_Register_${year}_${String(month).padStart(2, "0")}.xls`;
  return { filename, xmlContent };
}

/**
 * Generates official PDF Payslip format (Section 12).
 * Formats company name: NEXISPARKX PRIVATE LIMITED, official CIN: U62099MP2026PTC084748,
 * employee details, attendance summary, earnings and deductions breakdown, and net payable.
 */
export async function generatePayslipPdfBuffer(
  payrollId: string,
  currentUser: any
): Promise<{ buffer: Buffer; fileName: string }> {
  const p = await getPayrollById(payrollId, currentUser);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthName = monthNames[p.payrollMonth - 1] || `Month ${p.payrollMonth}`;

  // Minimal standard PDF generator with %PDF-1.4 header
  const title = `PAYSLIP FOR ${monthName.toUpperCase()} ${p.payrollYear}`;
  const companyHeader = "NEXISPARKX PRIVATE LIMITED";
  const cinHeader = "CIN: U62099MP2026PTC084748";

  const pdfBody = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 1200 >>
stream
BT
/F1 16 Tf
50 740 Td
(${companyHeader}) Tj
/F1 10 Tf
0 -16 Td
(${cinHeader}) Tj
/F1 12 Tf
0 -24 Td
(${title}) Tj
/F1 10 Tf
0 -20 Td
(Employee ID: ${p.employeeId}   |   Name: ${p.employeeName}) Tj
0 -16 Td
(Designation: ${p.designation || "N/A"}   |   Classification: ${p.employmentClassification}) Tj
0 -16 Td
(Period: ${new Date(p.periodStartDate).toISOString().split("T")[0]} to ${new Date(p.periodEndDate).toISOString().split("T")[0]}) Tj
0 -16 Td
(Status: ${p.status}   |   Payment Ref: ${p.paymentDetails?.transactionReference || "PENDING"}) Tj
0 -24 Td
(ATTENDANCE SUMMARY:) Tj
0 -14 Td
(Scheduled Working Days: ${p.scheduledWorkingDays}   |   Present: ${p.presentDays + p.lateDays}   |   Paid Leave: ${p.approvedPaidLeaveDays}) Tj
0 -14 Td
(Unpaid Leave: ${p.unpaidLeaveDays}   |   Absence: ${p.unapprovedAbsenceDays}   |   Weekly Offs: ${p.weeklyOffs}   |   Holidays: ${p.governmentHolidays}) Tj
0 -14 Td
(Eligible Payable Days: ${p.eligiblePayableDays} / ${p.totalCalendarDaysInMonth}) Tj
0 -24 Td
(EARNINGS & ALLOWANCES:) Tj
0 -14 Td
(Base Rate: INR ${p.baseSalaryOrStipend.toFixed(2)}   |   Payable Base: INR ${p.proratedBaseSalaryOrStipend.toFixed(2)}) Tj
0 -14 Td
(Total Allowances: INR ${p.totalAllowances.toFixed(2)}) Tj
0 -14 Td
(GROSS PAY: INR ${p.grossPay.toFixed(2)}) Tj
0 -24 Td
(DEDUCTIONS:) Tj
0 -14 Td
(Statutory / PF / ESI / TDS: INR ${p.totalDeductions.toFixed(2)}) Tj
0 -14 Td
(Loss of Pay Deductions: INR ${p.lossOfPayDeductions.toFixed(2)}) Tj
0 -14 Td
(TOTAL DEDUCTIONS: INR ${p.totalDeductions.toFixed(2)}) Tj
0 -24 Td
/F1 12 Tf
(NET PAYABLE: INR ${p.netPay.toFixed(2)}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000224 00000 n 
0000001476 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
1555
%%EOF`;

  const fileName = `Payslip_${p.employeeId}_${p.payrollYear}_${String(p.payrollMonth).padStart(2, "0")}.pdf`;
  return { buffer: Buffer.from(pdfBody, "ascii"), fileName };
}
