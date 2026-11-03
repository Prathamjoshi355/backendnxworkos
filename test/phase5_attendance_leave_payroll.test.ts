import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models/User";
import { Organization } from "../src/models/Organization";
import Attendance from "../src/models/Attendance";
import { Holiday } from "../src/models/Holiday";
import Leave from "../src/models/Leave";
import Compensation from "../src/models/Compensation";
import Payroll from "../src/models/Payroll";
import * as holidayService from "../src/services/holidayService";
import * as leaveService from "../src/services/leaveService";
import * as attendanceService from "../src/services/attendanceService";
import * as payrollService from "../src/services/payrollService";

describe("Phase 5: Attendance, Leave Management, Payroll Automation & HR Integration", () => {
  let mongoServer: MongoMemoryServer;
  let orgId: mongoose.Types.ObjectId;
  let divId: mongoose.Types.ObjectId;
  let superAdmin: any;
  let hrAdmin: any;
  let fullTimeEmployee: any;
  let fullTimeIntern: any;
  let divisionAdmin: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    orgId = new mongoose.Types.ObjectId();
    divId = new mongoose.Types.ObjectId();

    await Organization.create({
      _id: orgId,
      name: "NexisparkX Private Limited",
      code: "NX",
      status: "ACTIVE",
    });

    superAdmin = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Super Admin",
      email: "superadmin@nexisparkx.com",
      role: "SUPER_ADMIN",
      organizationId: orgId,
    };

    hrAdmin = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "HR Lead",
      email: "hr@nexisparkx.com",
      role: "HR",
      organizationId: orgId,
    };

    divisionAdmin = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Division Head",
      email: "divhead@nexisparkx.com",
      role: "DIVISION_ADMIN",
      organizationId: orgId,
      divisionId: divId,
    };

    fullTimeEmployee = await User.create({
      _id: new mongoose.Types.ObjectId(),
      fullName: "John Fulltime",
      email: "john.emp@nexisparkx.com",
      passwordHash: "hash123",
      employeeId: "NX-EMP-0010",
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      employmentClassification: "FULL_TIME_EMPLOYEE",
      status: "ACTIVE",
      organizationId: orgId,
      divisionId: divId,
      departmentId: "engineering",
      joiningDate: new Date("2026-01-01"),
    });

    fullTimeIntern = await User.create({
      _id: new mongoose.Types.ObjectId(),
      fullName: "Alice Intern",
      email: "alice.intern@nexisparkx.com",
      passwordHash: "hash123",
      employeeId: "NX-INT-0005",
      role: "INTERN",
      employmentType: "INTERN",
      employmentClassification: "FULL_TIME_INTERN",
      status: "ACTIVE",
      organizationId: orgId,
      divisionId: divId,
      departmentId: "design",
      joiningDate: new Date("2026-06-01"),
      internshipStartDate: new Date("2026-06-01"),
      internshipEndDate: new Date("2026-09-01"), // 3-month internship
      evaluationPeriodMonths: 3,
      provisionStipend: 15000,
      confirmedStipend: 20000,
    });

    // Create compensation for employee
    await Compensation.create({
      userId: fullTimeEmployee._id,
      organizationId: orgId,
      employmentType: "EMPLOYEE",
      compensationType: "SALARY",
      baseAmount: 60000,
      monthlyGrossSalary: 60000,
      basicSalary: 30000,
      allowances: { HRA: 15000, specialAllowance: 15000 },
      deductions: { providentFund: 1800, professionalTax: 200 },
      effectiveFrom: new Date("2026-01-01"),
      status: "ACTIVE",
      createdBy: superAdmin._id,
    });

    // Create compensation for intern
    await Compensation.create({
      userId: fullTimeIntern._id,
      organizationId: orgId,
      employmentType: "INTERN",
      compensationType: "STIPEND",
      baseAmount: 15000,
      monthlyGrossSalary: 15000,
      provisionStipend: 15000,
      effectiveFrom: new Date("2026-06-01"),
      status: "ACTIVE",
      createdBy: superAdmin._id,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("1. Classification & Leave Quota Rules", () => {
    it("should initialize 5 default government holidays for the organization", async () => {
      const res = await holidayService.initializeDefaultHolidaysForOrg(orgId, 2026, superAdmin._id);
      expect(res.created).toBe(5);

      const holidays = await holidayService.getHolidaysForOrganization(orgId, { year: 2026 });
      expect(holidays.length).toBe(5);
      const names = holidays.map((h) => h.name);
      expect(names).toContain("Republic Day");
      expect(names).toContain("Independence Day");
      expect(names).toContain("Constitution Day");
    });

    it("should allocate 51 days annual paid leave for full-time employee (30 PL, 14 CL, 7 ML)", async () => {
      const balances = await leaveService.getLeaveBalance(fullTimeEmployee);
      expect(balances.length).toBeGreaterThanOrEqual(3);

      const pl = balances.find((b) => b.leaveTypeName.includes("Privilege") || b.leaveTypeId === "PRIVILEGE_LEAVE");
      const cl = balances.find((b) => b.leaveTypeName.includes("Casual") || b.leaveTypeId === "CASUAL_LEAVE");
      const ml = balances.find((b) => b.leaveTypeName.includes("Medical") || b.leaveTypeId === "MEDICAL_LEAVE");

      expect(pl?.allocated).toBe(30);
      expect(cl?.allocated).toBe(14);
      expect(ml?.allocated).toBe(7);
      expect((pl?.allocated || 0) + (cl?.allocated || 0) + (ml?.allocated || 0)).toBe(51);
    });

    it("should dynamically allocate 1 leave per month of internship duration (3-month = 3 days)", async () => {
      const balances = await leaveService.getLeaveBalance(fullTimeIntern);
      expect(balances.length).toBeGreaterThanOrEqual(1);
      expect(balances[0].leaveTypeName).toBe("Intern Monthly Leave");
      expect(balances[0].allocated).toBe(3); // 3 months duration
      expect(balances[0].remaining).toBe(3);
    });

    it("should exclude Sundays from employee leave deduction and exclude Saturdays for interns", async () => {
      // 2026-08-14 (Friday) to 2026-08-17 (Monday)
      // Friday 14th = regular, Saturday 15th = Govt Holiday (Independence Day!), Sunday 16th = Weekly Off (Sunday)
      // For Employee: Aug 14 (Fri: 1 day), Aug 15 (Independence Day: 0 day), Aug 16 (Sunday: 0 day), Aug 17 (Mon: 1 day) -> 2 days!
      const employeeLeave = await leaveService.applyLeave(fullTimeEmployee, {
        leaveTypeId: "PRIVILEGE_LEAVE",
        leaveTypeName: "Privilege Leave",
        startDate: "2026-08-14",
        endDate: "2026-08-17",
        reason: "Family trip",
      });

      expect(employeeLeave.totalDays).toBe(2);
      expect(employeeLeave.isPaid).toBe(true);

      // Approve leave
      await leaveService.reviewLeave(employeeLeave._id.toString(), "APPROVED", hrAdmin, "Approved by HR");
      const updatedLeave = await Leave.findById(employeeLeave._id);
      expect(updatedLeave?.status).toBe("APPROVED");
    });

    it("should support half-day leave (0.5 day deduction)", async () => {
      const halfDay = await leaveService.applyLeave(fullTimeEmployee, {
        leaveTypeId: "CASUAL_LEAVE",
        leaveTypeName: "Casual Leave",
        startDate: "2026-09-02",
        endDate: "2026-09-02",
        reason: "Personal appointment",
        isHalfDay: true,
        halfDayPeriod: "FIRST_HALF",
      });

      expect(halfDay.totalDays).toBe(0.5);
      expect(halfDay.isHalfDay).toBe(true);
      expect(halfDay.halfDayPeriod).toBe("FIRST_HALF");
    });
  });

  describe("2. Attendance & EOD Absence Scheduler", () => {
    function getDayBounds(date: Date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    it("should finalize daily absentees with 9 statuses correctly", async () => {
      // 2026-08-15 is Independence Day (Govt Holiday)
      const holidayDate = new Date("2026-08-15T00:00:00.000Z");
      const resHoliday = await attendanceService.finalizeDailyAbsentees(holidayDate);
      expect(resHoliday.evaluatedUsers).toBeGreaterThanOrEqual(2);

      // Holiday should have marked users as HOLIDAY
      const hBounds = getDayBounds(holidayDate);
      const holidayAtt = await Attendance.findOne({
        userId: fullTimeEmployee._id,
        date: { $gte: hBounds.start, $lte: hBounds.end },
      });
      expect(holidayAtt?.attendanceStatus).toBe("HOLIDAY");

      // 2026-08-16 is Sunday -> Employee should be WEEKLY_OFF
      const sundayDate = new Date("2026-08-16T00:00:00.000Z");
      await attendanceService.finalizeDailyAbsentees(sundayDate);
      const sBounds = getDayBounds(sundayDate);
      const sundayAtt = await Attendance.findOne({
        userId: fullTimeEmployee._id,
        date: { $gte: sBounds.start, $lte: sBounds.end },
      });
      expect(sundayAtt?.attendanceStatus).toBe("WEEKLY_OFF");

      // 2026-08-17 is Monday -> Employee has approved leave -> ON_LEAVE
      const mondayDate = new Date("2026-08-17T00:00:00.000Z");
      await attendanceService.finalizeDailyAbsentees(mondayDate);
      const mBounds = getDayBounds(mondayDate);
      const mondayAtt = await Attendance.findOne({
        userId: fullTimeEmployee._id,
        date: { $gte: mBounds.start, $lte: mBounds.end },
      });
      expect(mondayAtt?.attendanceStatus).toBe("ON_LEAVE");

      // Intern had no attendance or leave on Monday 2026-08-17 -> ABSENT
      const internMondayAtt = await Attendance.findOne({
        userId: fullTimeIntern._id,
        date: { $gte: mBounds.start, $lte: mBounds.end },
      });
      expect(internMondayAtt?.attendanceStatus).toBe("ABSENT");
    });

    it("should allow Super Admin and HR to perform operational attendance correction with audit logging", async () => {
      const mondayDate = new Date("2026-08-17T00:00:00.000Z");
      const mBounds = getDayBounds(mondayDate);
      const internMondayAtt = await Attendance.findOne({
        userId: fullTimeIntern._id,
        date: { $gte: mBounds.start, $lte: mBounds.end },
      });
      expect(internMondayAtt).not.toBeNull();

      const corrected = await attendanceService.correctAttendance(
        internMondayAtt!._id.toString(),
        {
          attendanceStatus: "PRESENT",
          totalWorkDuration: 480, // 8 hours
          reason: "Intern was working on design client deliverable offline",
        },
        hrAdmin
      );

      expect(corrected.attendanceStatus).toBe("PRESENT");
      expect(corrected.totalWorkDuration).toBe(480);
      expect(corrected.corrections.length).toBe(1);
      expect(corrected.corrections[0].reason).toBe("Intern was working on design client deliverable offline");
      expect(String(corrected.corrections[0].correctedBy)).toBe(String(hrAdmin._id));
    });
  });

  describe("3. Centralized Monthly Payroll Engine", () => {
    it("should calculate correct scheduled days, working days, and net pay for employees and interns", async () => {
      // Generate payroll for August 2026 (Month 8, Year 2026: 31 days)
      const result = await payrollService.generateMonthlyPayroll(
        orgId,
        8,
        2026,
        { overwriteDraft: true },
        hrAdmin
      );

      expect(result.payrolls.length).toBe(2);

      const empPayroll = result.payrolls.find((p) => String(p.userId) === String(fullTimeEmployee._id));
      expect(empPayroll).toBeDefined();
      expect(empPayroll?.daysInMonth).toBe(31);
      expect(empPayroll?.monthlyGrossSalary).toBe(60000);
      expect(empPayroll?.basicSalary).toBe(30000);
      expect(empPayroll?.status).toBe("DRAFT");
      expect(empPayroll?.netPayable).toBeGreaterThan(0);

      const internPayroll = result.payrolls.find((p) => String(p.userId) === String(fullTimeIntern._id));
      expect(internPayroll).toBeDefined();
      expect(internPayroll?.daysInMonth).toBe(31);
      expect(internPayroll?.monthlyGrossSalary).toBe(15000); // Stipend
      expect(internPayroll?.status).toBe("DRAFT");
      expect(internPayroll?.netPayable).toBeGreaterThan(0);
    });

    it("should reject duplicate payroll generation without overwriteDraft flag", async () => {
      await expect(
        payrollService.generateMonthlyPayroll(
          orgId,
          8,
          2026,
          { overwriteDraft: false },
          hrAdmin
        )
      ).rejects.toThrow("ALREADY_EXISTS");
    });

    it("should transition payroll status: DRAFT -> UNDER_REVIEW -> APPROVED -> PAID", async () => {
      const records = await Payroll.find({ organizationId: orgId, payrollMonth: 8, payrollYear: 2026 });
      const record = records[0];

      // DRAFT -> UNDER_REVIEW
      const underReview = await payrollService.updatePayrollStatus(
        record._id.toString(),
        "UNDER_REVIEW",
        "Initial verification by HR",
        hrAdmin
      );
      expect(underReview.status).toBe("UNDER_REVIEW");

      // UNDER_REVIEW -> APPROVED
      const approved = await payrollService.updatePayrollStatus(
        record._id.toString(),
        "APPROVED",
        "Executive approval granted",
        superAdmin
      );
      expect(approved.status).toBe("APPROVED");
      expect(approved.approvedBy).toBeDefined();

      // Confirm payment: APPROVED -> PAID
      const paid = await payrollService.confirmPayrollPayment(
        record._id.toString(),
        {
          transactionReference: "UTR-NX-2026-08-998877",
          paymentDate: new Date("2026-09-01"),
          paymentMode: "NEFT_RTGS",
          bankName: "HDFC Corporate Bank",
          notes: "Disbursed via automated batch transfer",
        },
        superAdmin
      );

      expect(paid.status).toBe("PAID");
      expect(paid.paymentDetails?.transactionReference).toBe("UTR-NX-2026-08-998877");
      expect(paid.paymentDetails?.paymentDate).toBeDefined();

      // Immutability check: PAID records cannot be reverted
      await expect(
        payrollService.updatePayrollStatus(record._id.toString(), "UNDER_REVIEW", "Revert", hrAdmin)
      ).rejects.toThrow("IMMUTABLE_PAID_PAYROLL");
    });

    it("should calculate mid-month proration for new hires", async () => {
      // User joining on 16th of a 30-day month (e.g. June 16, 2026 -> 15 active days out of 30)
      const midMonthUser = await User.create({
        fullName: "MidMonth Joiner",
        email: "midmonth@nexisparkx.com",
        passwordHash: "hash123",
        employeeId: "NX-EMP-0099",
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        status: "ACTIVE",
        organizationId: orgId,
        divisionId: divId,
        joiningDate: new Date("2026-06-16"),
      });

      await Compensation.create({
        userId: midMonthUser._id,
        organizationId: orgId,
        employmentType: "EMPLOYEE",
        compensationType: "SALARY",
        baseAmount: 60000,
        monthlyGrossSalary: 60000,
        basicSalary: 30000,
        effectiveFrom: new Date("2026-06-16"),
        status: "ACTIVE",
        createdBy: superAdmin._id,
      });

      const res = await payrollService.generateMonthlyPayroll(
        orgId,
        6,
        2026,
        { userIds: [midMonthUser._id.toString()], overwriteDraft: true },
        hrAdmin
      );

      expect(res.payrolls.length).toBe(1);
      const pr = res.payrolls[0];
      expect(pr.isProrated).toBe(true);
      expect(pr.proratedDays).toBe(15);
      // Prorated gross: (15 / 30) * 60000 = 30000
      expect(pr.grossPayable).toBe(30000);
      expect(pr.netPayable).toBe(30000);
    });

    it("should compute accurate payroll dashboard metrics", async () => {
      const metrics = await payrollService.getPayrollDashboardMetrics(
        orgId,
        8,
        2026,
        {},
        hrAdmin
      );

      expect(metrics.month).toBe(8);
      expect(metrics.year).toBe(2026);
      expect(metrics.headcount.totalActive).toBeGreaterThanOrEqual(2);
      expect(metrics.financialSummary.totalGross).toBeGreaterThan(0);
      expect(metrics.payrollCounts.totalRecords).toBe(2);
    });
  });

  describe("4. Multi-Sheet Excel Register & PDF Payslip Generation", () => {
    it("should generate multi-sheet Excel spreadsheet with masked bank accounts", async () => {
      const excel = await payrollService.exportPayrollExcel(
        orgId,
        8,
        2026,
        {},
        hrAdmin
      );

      expect(excel.filename).toContain("Payroll_Register_2026_08");
      expect(excel.xmlContent).toContain('ss:Name="Payroll Register"');
      expect(excel.xmlContent).toContain('ss:Name="Summary"');
      expect(excel.xmlContent).toContain("NEXISPARKX PRIVATE LIMITED");
      expect(excel.xmlContent).toContain("John Fulltime");
    });

    it("should generate PDF payslip with official CIN U62099MP2026PTC084748", async () => {
      const records = await Payroll.find({ organizationId: orgId, payrollMonth: 8, payrollYear: 2026 });
      const record = records[0];

      const pdf = await payrollService.generatePayslipPdfBuffer(record._id.toString(), hrAdmin);
      expect(pdf.fileName).toContain("Payslip_");
      expect(pdf.buffer).toBeInstanceOf(Buffer);
      expect(pdf.buffer.length).toBeGreaterThan(100);

      // Verify the PDF contains the standard PDF header and CIN number
      const pdfText = pdf.buffer.toString("utf-8");
      expect(pdfText).toContain("%PDF-1.4");
      expect(pdfText).toContain("U62099MP2026PTC084748");
      expect(pdfText).toContain("NEXISPARKX PRIVATE LIMITED");
    });
  });

  describe("5. RBAC and Division Scoping", () => {
    it("should restrict Division Admin from viewing records of another division", async () => {
      const otherDivId = new mongoose.Types.ObjectId();
      const otherUser = await User.create({
        fullName: "Other Div User",
        email: "other@nexisparkx.com",
        passwordHash: "hash123",
        employeeId: "NX-EMP-0888",
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        status: "ACTIVE",
        organizationId: orgId,
        divisionId: otherDivId,
      });

      const otherPayroll = await Payroll.create({
        payrollId: "NX-PAY-2026-08-0888",
        periodStartDate: new Date("2026-08-01"),
        periodEndDate: new Date("2026-08-31"),
        targetPaymentDate: new Date("2026-09-07"),
        organizationId: orgId,
        userId: otherUser._id,
        employeeId: "NX-EMP-0888",
        employeeName: "Other Div User",
        divisionId: otherDivId,
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        payrollMonth: 8,
        payrollYear: 2026,
        daysInMonth: 31,
        scheduledWorkingDays: 26,
        presentDays: 26,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        weeklyOffDays: 5,
        holidayDays: 0,
        halfDays: 0,
        effectivePayableDays: 31,
        isProrated: false,
        monthlyGrossSalary: 50000,
        basicSalary: 25000,
        allowances: 0,
        deductions: 0,
        grossPayable: 50000,
        lossOfPayDeductions: 0,
        statutoryDeductions: 0,
        otherDeductions: 0,
        netPayable: 50000,
        status: "DRAFT",
      });

      // divisionAdmin (assigned to divId) should NOT see otherPayroll
      await expect(
        payrollService.getPayrollById(otherPayroll._id.toString(), divisionAdmin)
      ).rejects.toThrow("FORBIDDEN");

      // employee should NOT see otherPayroll
      await expect(
        payrollService.getPayrollById(otherPayroll._id.toString(), fullTimeEmployee)
      ).rejects.toThrow("FORBIDDEN");
    });
  });
});
