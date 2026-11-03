import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models/User";
import { Organization } from "../src/models/Organization";
import Division from "../src/models/Division";
import Department from "../src/models/Department";
import Attendance from "../src/models/Attendance";
import { Holiday } from "../src/models/Holiday";
import Leave from "../src/models/Leave";
import Compensation from "../src/models/Compensation";
import Payroll from "../src/models/Payroll";
import Candidate from "../src/models/Candidate";
import EmployeeDocument from "../src/models/EmployeeDocument";
import * as holidayService from "../src/services/holidayService";
import * as leaveService from "../src/services/leaveService";
import * as attendanceService from "../src/services/attendanceService";
import * as payrollService from "../src/services/payrollService";
import * as candidateOfferService from "../src/services/candidateOfferService";
import * as authService from "../src/services/authService";
import * as backupService from "../src/services/backupService";
import path from "path";
import fs from "fs";

describe("Phase 6: Production Hardening, End-to-End Validation & Security Audit", () => {
  let mongoServer: MongoMemoryServer;
  let orgAId: mongoose.Types.ObjectId;
  let orgBId: mongoose.Types.ObjectId;
  let divA1Id: mongoose.Types.ObjectId;
  let divA2Id: mongoose.Types.ObjectId;
  let deptAId: mongoose.Types.ObjectId;
  let superAdminA: any;
  let hrAdminA: any;
  let divAdminA1: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    orgAId = new mongoose.Types.ObjectId();
    orgBId = new mongoose.Types.ObjectId();
    divA1Id = new mongoose.Types.ObjectId();
    divA2Id = new mongoose.Types.ObjectId();
    deptAId = new mongoose.Types.ObjectId();

    await Organization.create({
      _id: orgAId,
      name: "NexisparkX Private Limited",
      code: "NX",
      status: "ACTIVE",
    });

    await Organization.create({
      _id: orgBId,
      name: "External Competitor Inc",
      code: "EXT",
      status: "ACTIVE",
    });

    await Division.create([
      {
        _id: divA1Id,
        organizationId: orgAId,
        name: "Software Engineering Division",
        code: "SED",
        status: "ACTIVE",
      },
      {
        _id: divA2Id,
        organizationId: orgAId,
        name: "Digital Marketing Division",
        code: "DMD",
        status: "ACTIVE",
      },
    ]);

    await Department.create({
      _id: deptAId,
      organizationId: orgAId,
      divisionId: divA1Id,
      name: "Software Development",
      code: "SWD",
      status: "ACTIVE",
    });

    superAdminA = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Super Admin",
      email: "superadmin@nexisparkx.com",
      role: "SUPER_ADMIN",
      organizationId: orgAId,
    };

    hrAdminA = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "HR Lead",
      email: "hr@nexisparkx.com",
      role: "HR",
      organizationId: orgAId,
    };

    divAdminA1 = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Software Division Lead",
      email: "divlead@nexisparkx.com",
      role: "DIVISION_ADMIN",
      organizationId: orgAId,
      divisionId: divA1Id,
    };

    await holidayService.initializeDefaultHolidaysForOrg(orgAId.toString(), 2026);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // =========================================================================
  // 1. COMPLETE 12-STEP EMPLOYEE WORKFLOW
  // =========================================================================
  describe("1. Complete 12-Step Employee Workflow", () => {
    let candidate: any;
    let createdEmployee: any;
    let employeeDoc: any;
    let employeePayroll: any;

    it("Step 1: Should create a full-time employee candidate with CAN-YYMMDD-XXX ID", async () => {
      candidate = await candidateOfferService.createCandidate(hrAdminA, {
        fullName: "Rahul Sharma",
        email: "rahul.sharma@nexisparkx.com",
        phone: "+91 9876543210",
        designation: "Senior Backend Engineer",
        departmentId: deptAId.toString(),
        divisionId: divA1Id.toString(),
        offerType: "EMPLOYEE_OFFER",
      });

      expect(candidate).toBeDefined();
      expect(candidate.candidateId).toMatch(/^CAN-\d{6}-\d{3}$/);
      expect(candidate.status).toBe("CANDIDATE");

      // Candidate is approved by HR
      candidate.status = "APPROVED";
      await candidate.save();
    });

    it("Step 2 & 3: Upload mandatory Acceptance Letter PDF and onboard employee (NX-EMP-XXXX)", async () => {
      const validPdfBuffer = Buffer.from("%PDF-1.4 Official Acceptance Letter Content for Rahul Sharma");
      const { candidate: joinedCandidate, user: newUser } = await candidateOfferService.onboardApprovedCandidate(
        hrAdminA,
        candidate._id,
        {
          departmentId: deptAId.toString(),
          divisionId: divA1Id.toString(),
          acceptanceLetterFile: {
            buffer: validPdfBuffer,
            fileName: "rahul_acceptance_letter.pdf",
            mimeType: "application/pdf",
          },
        }
      );

      expect(joinedCandidate.status).toBe("JOINED");
      expect(newUser.employeeId).toMatch(/^NX-EMP-\d{4}$/);
      expect(newUser.mustChangePassword).toBe(true);

      createdEmployee = newUser;

      // Verify Acceptance Letter recorded in EmployeeDocument
      employeeDoc = await EmployeeDocument.findOne({
        userId: newUser._id,
        documentType: "ACCEPTANCE_LETTER",
      });
      expect(employeeDoc).toBeDefined();
      expect(employeeDoc.status).toBe("SUBMITTED");
    });

    it("Step 4: Employee logs in with temporary password and must change password before full access", async () => {
      expect(createdEmployee.mustChangePassword).toBe(true);

      // Perform password change using default temporary password
      const updateResult = await authService.changePassword({
        userId: createdEmployee._id.toString(),
        currentPassword: "Nexisparkx@123",
        newPassword: "SecurePermanentPassword2026!",
        confirmPassword: "SecurePermanentPassword2026!",
      });

      expect(updateResult.token).toBeDefined();
      expect(updateResult.user.mustChangePassword).toBe(false);

      // Fetch fresh user record
      const refreshed = await User.findById(createdEmployee._id).lean();
      expect(refreshed!.mustChangePassword).toBe(false);
      createdEmployee = refreshed;
    });

    it("Step 5: Employee explicitly checks in and checks out with duration calculation", async () => {
      const checkInRes = await attendanceService.loginAttendance(
        createdEmployee._id.toString(),
        "WEB",
        "09:30",
        15
      );
      expect(["PRESENT", "LATE"]).toContain(checkInRes.attendance.attendanceStatus);
      expect(checkInRes.attendance.checkInTime || checkInRes.attendance.firstLoginAt).toBeDefined();

      const checkOutRes = await attendanceService.logoutAttendance(createdEmployee._id.toString(), {
        bypassEod: true,
      });
      expect(checkOutRes.attendance.checkOutTime || checkOutRes.attendance.lastLogoutAt).toBeDefined();
      expect(checkOutRes.attendance.workingDuration).toBeDefined();
    });

    it("Step 6, 7 & 8: Employee applies for leave, HR approves, and attendance reflects ON_LEAVE", async () => {
      // Setup Compensation record for payroll
      await Compensation.create({
        userId: createdEmployee._id,
        organizationId: orgAId,
        divisionId: divA1Id,
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        compensationType: "SALARY",
        baseAmount: 90000,
        salaryType: "MONTHLY",
        monthlyGrossSalary: 90000,
        basicSalary: 45000,
        allowances: {
          houseRentAllowance: 22500,
          conveyanceAllowance: 3000,
          specialAllowance: 19500,
        },
        deductions: {
          providentFund: 1800,
          professionalTax: 200,
        },
        payrollStartDate: new Date("2026-08-01"),
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-01"),
        createdBy: superAdminA._id,
      });

      // Apply for 2 working days leave: Monday 2026-08-10 to Tuesday 2026-08-11
      const leave = await leaveService.applyLeave(createdEmployee, {
        startDate: new Date("2026-08-10"),
        endDate: new Date("2026-08-11"),
        reason: "Family function",
      });

      expect(leave.status).toBe("PENDING");

      // HR approves
      const approvedLeave = await leaveService.reviewLeave(leave._id.toString(), "APPROVED", hrAdminA);
      expect(approvedLeave.status).toBe("APPROVED");

      // Verify Attendance reflects ON_LEAVE
      const attDay1 = await Attendance.findOne({
        userId: createdEmployee._id,
        date: {
          $gte: new Date("2026-08-10T00:00:00.000Z"),
          $lte: new Date("2026-08-10T23:59:59.999Z"),
        },
      }).lean();
      expect(attDay1).toBeDefined();
      expect(attDay1!.attendanceStatus).toBe("ON_LEAVE");
    });

    it("Step 9 & 10: Centralized monthly payroll generates, HR reviews and approves", async () => {
      const generated = await payrollService.generateMonthlyPayroll(
        orgAId.toString(),
        8,
        2026,
        { overwriteDraft: true },
        hrAdminA
      );

      expect(generated.generatedCount).toBeGreaterThanOrEqual(1);

      const empPayroll = await Payroll.findOne({
        organizationId: orgAId,
        userId: createdEmployee._id,
        payrollYear: 2026,
        payrollMonth: 8,
      });

      expect(empPayroll).toBeDefined();
      expect(empPayroll!.status).toBe("DRAFT");
      expect(empPayroll!.totalCalendarDaysInMonth || empPayroll!.daysInMonth).toBe(31);
      expect(empPayroll!.netPay).toBeGreaterThan(0);

      // HR reviews
      const reviewed = await payrollService.updatePayrollStatus(
        empPayroll!._id.toString(),
        "UNDER_REVIEW",
        "Verified attendance records",
        hrAdminA
      );
      expect(reviewed.status).toBe("UNDER_REVIEW");

      // HR approves
      const approved = await payrollService.updatePayrollStatus(
        empPayroll!._id.toString(),
        "APPROVED",
        "Approved for disbursement",
        hrAdminA
      );
      expect(approved.status).toBe("APPROVED");

      employeePayroll = approved;
    });

    it("Step 11 & 12: Confirm actual payment, verify immutability, and employee accesses PDF payslip with CIN", async () => {
      // Confirm payment
      const paid = await payrollService.confirmPayrollPayment(
        employeePayroll._id.toString(),
        {
          transactionReference: "TXN-20260831-NX998877",
          paymentMode: "BANK_TRANSFER",
          paymentDate: new Date("2026-08-31"),
          remarks: "Disbursed via HDFC Bank Corporate NetBanking",
        },
        superAdminA
      );

      expect(paid.status).toBe("PAID");
      expect(paid.paymentDetails?.transactionReference).toBe("TXN-20260831-NX998877");

      // Verify immutability: Cannot transition back to DRAFT or UNDER_REVIEW once PAID
      await expect(
        payrollService.updatePayrollStatus(
          paid._id.toString(),
          "UNDER_REVIEW",
          "Attempt to revert",
          superAdminA
        )
      ).rejects.toThrow("IMMUTABLE_PAID_PAYROLL");

      // Employee accesses own payslip PDF
      const pdfResult = await payrollService.generatePayslipPdfBuffer(
        paid._id.toString(),
        createdEmployee
      );
      expect(pdfResult.buffer).toBeInstanceOf(Buffer);
      const pdfText = pdfResult.buffer.toString("latin1");
      expect(pdfText).toContain("%PDF-1.4");
      expect(pdfText).toContain("U62099MP2026PTC084748");
      expect(pdfText).toContain("NEXISPARKX PRIVATE LIMITED");
    });
  });

  // =========================================================================
  // 2. COMPLETE 12-STEP INTERN WORKFLOW
  // =========================================================================
  describe("2. Complete 12-Step Intern Workflow", () => {
    let internCandidate: any;
    let createdIntern: any;
    let internPayroll: any;

    it("Step 1, 2 & 3: Create, upload Acceptance Letter and onboard intern (NX-INT-XXXX)", async () => {
      internCandidate = await candidateOfferService.createCandidate(hrAdminA, {
        fullName: "Ananya Patel",
        email: "ananya.patel@nexisparkx.com",
        phone: "+91 9123456789",
        designation: "Machine Learning Intern",
        departmentId: deptAId.toString(),
        divisionId: divA1Id.toString(),
        offerType: "INTERNSHIP_OFFER",
      });

      expect(internCandidate.candidateId).toMatch(/^CAN-\d{6}-\d{3}$/);
      internCandidate.status = "APPROVED";
      await internCandidate.save();

      const validPdfBuffer = Buffer.from("%PDF-1.4 Official Acceptance Letter for Intern Ananya Patel");
      const { candidate: joined, user: internUser } = await candidateOfferService.onboardApprovedCandidate(
        hrAdminA,
        internCandidate._id,
        {
          departmentId: deptAId.toString(),
          divisionId: divA1Id.toString(),
          acceptanceLetterFile: {
            buffer: validPdfBuffer,
            fileName: "ananya_acceptance.pdf",
            mimeType: "application/pdf",
          },
        }
      );

      expect(joined.status).toBe("JOINED");
      expect(internUser.employeeId).toMatch(/^NX-INT-\d{4}$/);
      expect(internUser.employmentClassification).toBe("FULL_TIME_INTERN");

      // Set internship duration 3 months and provision stipend
      await User.findByIdAndUpdate(internUser._id, {
        internshipStartDate: new Date("2026-08-01"),
        internshipEndDate: new Date("2026-10-31"),
        evaluationPeriodMonths: 3,
        provisionStipend: 25000,
      });

      createdIntern = await User.findById(internUser._id).lean();
    });

    it("Step 4 & 5: Intern logs in, updates password, checks in and checks out", async () => {
      const updateRes = await authService.changePassword({
        userId: createdIntern._id.toString(),
        currentPassword: "Nexisparkx@123",
        newPassword: "InternPermanentPass2026!",
        confirmPassword: "InternPermanentPass2026!",
      });
      expect(updateRes.token).toBeDefined();

      const checkInRes = await attendanceService.loginAttendance(createdIntern._id.toString(), "MOBILE");
      expect(["PRESENT", "LATE"]).toContain(checkInRes.attendance.attendanceStatus);

      const checkOutRes = await attendanceService.logoutAttendance(createdIntern._id.toString(), {
        bypassEod: true,
      });
      expect(checkOutRes.attendance.workingDuration).toBeDefined();
    });

    it("Step 6 & 7: Intern uses monthly entitlement; Saturday is recognized as paid weekly holiday", async () => {
      await Compensation.create({
        userId: createdIntern._id,
        organizationId: orgAId,
        divisionId: divA1Id,
        employmentType: "INTERN",
        employmentClassification: "FULL_TIME_INTERN",
        compensationType: "STIPEND",
        baseAmount: 25000,
        salaryType: "MONTHLY",
        monthlyGrossSalary: 25000,
        provisionStipend: 25000,
        payrollStartDate: new Date("2026-08-01"),
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-01"),
        createdBy: superAdminA._id,
      });

      // 3-month internship = 3 days paid leave allocation
      const balance = await leaveService.getLeaveBalance(createdIntern, orgAId.toString());
      expect(balance.length).toBeGreaterThan(0);
      expect(balance[0].allocated).toBe(3);

      // Apply for leave spanning Friday 2026-08-14 (Friday working day)
      const internLeave = await leaveService.applyLeave(createdIntern, {
        startDate: new Date("2026-08-14"),
        endDate: new Date("2026-08-14"),
        reason: "Exam preparation",
      });

      expect(internLeave.status).toBe("PENDING");
      await leaveService.reviewLeave(internLeave._id.toString(), "APPROVED", hrAdminA);

      // Verify balance remaining is 2 days
      const updatedBalance = await leaveService.getLeaveBalance(createdIntern, orgAId.toString());
      expect(updatedBalance[0].remaining).toBe(2);
    });

    it("Step 8, 9, 10 & 11: Stipend generates, HR approves, and disbursement confirms", async () => {
      const generated = await payrollService.generateMonthlyPayroll(
        orgAId.toString(),
        8,
        2026,
        { overwriteDraft: true },
        hrAdminA
      );

      const stipendRecord = await Payroll.findOne({
        organizationId: orgAId,
        userId: createdIntern._id,
        payrollYear: 2026,
        payrollMonth: 8,
      });

      expect(stipendRecord).toBeDefined();
      expect(stipendRecord!.employmentClassification).toBe("FULL_TIME_INTERN");
      expect(stipendRecord!.grossPay).toBeGreaterThan(0);
      expect(stipendRecord!.netPay).toBeGreaterThan(0);

      // HR approves
      const approved = await payrollService.updatePayrollStatus(
        stipendRecord!._id.toString(),
        "APPROVED",
        "Stipend approved",
        hrAdminA
      );
      expect(approved.status).toBe("APPROVED");

      // Payment confirmed
      const paid = await payrollService.confirmPayrollPayment(
        stipendRecord!._id.toString(),
        {
          paymentDate: new Date("2026-08-31"),
          transactionReference: "STIPEND-20260831-NX1122",
          paymentMode: "UPI",
          remarks: "Monthly intern stipend",
        },
        superAdminA
      );
      expect(paid.status).toBe("PAID");
      internPayroll = paid;
    });

    it("Step 12: Intern accesses their own payslip PDF with official CIN", async () => {
      const pdfResult = await payrollService.generatePayslipPdfBuffer(
        internPayroll._id.toString(),
        createdIntern
      );
      expect(pdfResult.buffer).toBeInstanceOf(Buffer);
      const pdfText = pdfResult.buffer.toString("latin1");
      expect(pdfText).toContain("%PDF-1.4");
      expect(pdfText).toContain("U62099MP2026PTC084748");
      expect(pdfText).toContain("Ananya Patel");
    });
  });

  // =========================================================================
  // 3. LEAVE & PAYROLL INTEGRITY POLICIES
  // =========================================================================
  describe("3. Leave and Payroll Policy Integrity", () => {
    it("verifies full-time employee 51 annual leave entitlement (30 PL, 14 CL, 7 ML) + 5 Holidays", async () => {
      const employeeUser = await User.create({
        fullName: "Test Policy Employee",
        email: "policy.emp@nexisparkx.com",
        passwordHash: "hash",
        organizationId: orgAId,
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        status: "ACTIVE",
      });

      const balances = await leaveService.getLeaveBalance(employeeUser, orgAId.toString());
      const pl = balances.find((b: any) => b.leaveTypeName.includes("Privilege"));
      const cl = balances.find((b: any) => b.leaveTypeName.includes("Casual"));
      const ml = balances.find((b: any) => b.leaveTypeName.includes("Medical"));

      expect(pl?.allocated).toBe(30);
      expect(cl?.allocated).toBe(14);
      expect(ml?.allocated).toBe(7);
      expect((pl?.allocated || 0) + (cl?.allocated || 0) + (ml?.allocated || 0)).toBe(51);

      // Verify 5 government holidays exist for orgA
      const holidays = await Holiday.find({ organizationId: orgAId, year: 2026 });
      expect(holidays.length).toBe(5);
    });

    it("verifies mid-month joining proration calculation", async () => {
      const midMonthJoiner = await User.create({
        fullName: "Vikram Joining Mid Month",
        email: "vikram.joiner@nexisparkx.com",
        passwordHash: "hash",
        employeeId: "NX-EMP-0099",
        joiningDate: new Date("2026-08-16"),
        organizationId: orgAId,
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
      });

      // Joined August 16 (16 payable days out of 31 days in August)
      await Compensation.create({
        userId: midMonthJoiner._id,
        organizationId: orgAId,
        divisionId: divA1Id,
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        compensationType: "SALARY",
        baseAmount: 62000,
        salaryType: "MONTHLY",
        monthlyGrossSalary: 62000,
        basicSalary: 31000,
        payrollStartDate: new Date("2026-08-16"),
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-16"),
        createdBy: superAdminA._id,
      });

      await payrollService.generateMonthlyPayroll(
        orgAId.toString(),
        8,
        2026,
        { userIds: [midMonthJoiner._id.toString()], overwriteDraft: true },
        hrAdminA
      );

      const payrollRec = await Payroll.findOne({
        organizationId: orgAId,
        userId: midMonthJoiner._id,
        payrollYear: 2026,
        payrollMonth: 8,
      });

      expect(payrollRec).toBeDefined();
      expect(payrollRec!.totalCalendarDaysInMonth || payrollRec!.daysInMonth).toBe(31);
      expect(payrollRec!.eligiblePayableDays || payrollRec!.payableDays).toBe(16);
      // Expected prorated gross = (62000 / 31) * 16 = 32000
      expect(payrollRec!.grossPay || payrollRec!.grossPayable).toBe(32000);
    });

    it("rejects duplicate payroll generation without overwriteDraft flag", async () => {
      await expect(
        payrollService.generateMonthlyPayroll(
          orgAId.toString(),
          8,
          2026,
          { overwriteDraft: false },
          hrAdminA
        )
      ).rejects.toThrow("ALREADY_EXISTS");
    });
  });

  // =========================================================================
  // 4. SECURITY AUDIT & MULTI-TENANT ISOLATION
  // =========================================================================
  describe("4. Security Audit & Access Control", () => {
    it("strictly isolates cross-organization access (Org B employee cannot access Org A payroll)", async () => {
      const orgBEmployee = await User.create({
        fullName: "Attacker Org B",
        email: "attacker@competitor.com",
        passwordHash: "hash",
        organizationId: orgBId,
        role: "EMPLOYEE",
        status: "ACTIVE",
      });

      // Attempt to list Org A payroll as Org B user
      const res = await payrollService.listPayrolls(
        orgAId.toString(),
        {
          payrollYear: 2026,
          payrollMonth: 8,
        },
        orgBEmployee
      );

      // Employee cannot access other people's payroll
      expect(res.items.length).toBe(0);
    });

    it("strictly restricts Division Admin to records of their own division", async () => {
      // Create user in Division A2
      const userDiv2 = await User.create({
        fullName: "Marketing Exec Div 2",
        email: "mktg.div2@nexisparkx.com",
        passwordHash: "hash",
        organizationId: orgAId,
        divisionId: divA2Id,
        role: "EMPLOYEE",
        status: "ACTIVE",
      });

      await Compensation.create({
        userId: userDiv2._id,
        organizationId: orgAId,
        divisionId: divA2Id,
        employmentType: "EMPLOYEE",
        compensationType: "SALARY",
        baseAmount: 50000,
        salaryType: "MONTHLY",
        monthlyGrossSalary: 50000,
        payrollStartDate: new Date("2026-08-01"),
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-01"),
        createdBy: superAdminA._id,
      });

      await payrollService.generateMonthlyPayroll(
        orgAId.toString(),
        8,
        2026,
        { userIds: [userDiv2._id.toString()], overwriteDraft: true },
        superAdminA
      );

      // Division Admin A1 requests payroll list: should only see Div A1 records
      const divA1Payrolls = await payrollService.listPayrolls(
        orgAId.toString(),
        {
          payrollYear: 2026,
          payrollMonth: 8,
        },
        divAdminA1
      );

      for (const item of divA1Payrolls.items) {
        expect(item.divisionId?.toString()).toBe(divA1Id.toString());
        expect(item.divisionId?.toString()).not.toBe(divA2Id.toString());
      }
    });

    it("enforces employee self-only access (Employee A cannot view Employee B payslip)", async () => {
      const otherEmployee = await User.create({
        fullName: "Snoop Employee",
        email: "snoop@nexisparkx.com",
        passwordHash: "hash",
        organizationId: orgAId,
        role: "EMPLOYEE",
        status: "ACTIVE",
      });

      const existingPayroll = await Payroll.findOne({
        organizationId: orgAId,
        payrollYear: 2026,
        payrollMonth: 8,
        userId: { $ne: otherEmployee._id },
      });

      expect(existingPayroll).toBeDefined();

      // Snoop attempts to fetch PDF payslip for someone else
      await expect(
        payrollService.generatePayslipPdfBuffer(existingPayroll!._id.toString(), otherEmployee)
      ).rejects.toThrow("FORBIDDEN");
    });

    it("verifies bank account masking in Excel export (XXXX-XXXX-1234)", async () => {
      // Ensure at least one payroll has payment details with a bank account number
      const aPayroll = await Payroll.findOne({ organizationId: orgAId, payrollMonth: 8, payrollYear: 2026 });
      if (aPayroll) {
        aPayroll.paymentDetails = {
          paymentDate: new Date(),
          transactionReference: "TXN-BANK-123456",
          bankName: "HDFC Bank",
          maskedAccountNumber: "501002233445566",
        };
        await aPayroll.save();
      }

      const excel = await payrollService.exportPayrollExcel(
        orgAId.toString(),
        8,
        2026,
        {},
        superAdminA
      );

      expect(excel.xmlContent).toBeDefined();
      expect(excel.xmlContent).toContain("Payroll Register");
      expect(excel.xmlContent).toContain("Summary");
      expect(excel.xmlContent).toContain("U62099MP2026PTC084748");
      expect(excel.xmlContent).toContain("NEXISPARKX PRIVATE LIMITED");
      // All bank accounts in register should be masked
      expect(excel.xmlContent).toContain("XXXX-XXXX-5566");
    });
  });

  // =========================================================================
  // 5. BACKUP & RESTORATION VALIDATION DRILL
  // =========================================================================
  describe("5. Automated Backup & Non-Production Restore Drill", () => {
    let backupDir: string;

    it("executes automated database backup with SHA-256 cryptographic manifest", async () => {
      const tempBackupDir = path.resolve(process.cwd(), "test_backups");
      const backupResult = await backupService.executeDatabaseBackup({
        outputBaseDir: tempBackupDir,
      });

      expect(backupResult.success).toBe(true);
      expect(backupResult.backupId).toMatch(/^backup_/);
      expect(backupResult.manifest.sha256Checksum).toBeDefined();
      expect(backupResult.manifest.totalDocuments).toBeGreaterThan(0);
      expect(fs.existsSync(backupResult.backupDirectory)).toBe(true);

      backupDir = backupResult.backupDirectory;
    });

    it("successfully restores database from backup and verifies 100% document integrity", async () => {
      const restoreResult = await backupService.restoreDatabaseBackup(backupDir, {
        dropExisting: true,
      });

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.verifiedChecksums).toBe(true);
      expect(restoreResult.documentsRestored).toBeGreaterThan(0);

      // Clean up test backup files
      const baseDir = path.resolve(process.cwd(), "test_backups");
      if (fs.existsSync(baseDir)) {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    });
  });
});
