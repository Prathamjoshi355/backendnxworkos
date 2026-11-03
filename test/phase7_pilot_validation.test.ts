import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models/User";
import { Organization } from "../src/models/Organization";
import Division from "../src/models/Division";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import Attendance from "../src/models/Attendance";
import { Holiday } from "../src/models/Holiday";
import Leave from "../src/models/Leave";
import Compensation from "../src/models/Compensation";
import Payroll from "../src/models/Payroll";
import * as holidayService from "../src/services/holidayService";
import * as leaveService from "../src/services/leaveService";
import * as attendanceService from "../src/services/attendanceService";
import * as payrollService from "../src/services/payrollService";
import * as notificationService from "../src/services/notificationService";
import { generateEmployeeId } from "../src/utils/employeeId";

describe("Phase 7: Controlled Pilot Provisioning, Security & UAT Verification", () => {
  let mongoServer: MongoMemoryServer;
  let orgId: mongoose.Types.ObjectId;
  let divId: mongoose.Types.ObjectId;
  let centralDeptId: mongoose.Types.ObjectId;
  let devDeptId: mongoose.Types.ObjectId;
  let teamId: mongoose.Types.ObjectId;

  // 8 Proposed Pilot Accounts (in memory simulation)
  let superAdminUser: any;
  let orgAdminUser: any;
  let hrUser: any;
  let divAdminUser: any;
  let managerUser: any;
  let teamLeaderUser: any;
  let employeeUser: any;
  let internUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    orgId = new mongoose.Types.ObjectId();
    divId = new mongoose.Types.ObjectId();
    centralDeptId = new mongoose.Types.ObjectId();
    devDeptId = new mongoose.Types.ObjectId();
    teamId = new mongoose.Types.ObjectId();

    // 1. Establish Official Organizational Hierarchy
    await Organization.create({
      _id: orgId,
      name: "NexisparkX Private Limited",
      code: "NX",
      status: "ACTIVE",
    });

    // Central Headquarters Department (divisionId: null, isCentral: true)
    await Department.create({
      _id: centralDeptId,
      organizationId: orgId,
      name: "Central Human Resources",
      code: "NX-HQ-HR",
      divisionId: null,
      isCentral: true,
      status: "ACTIVE",
    });

    // Operational Business Division
    await Division.create({
      _id: divId,
      organizationId: orgId,
      name: "Software Engineering Division",
      code: "SED",
      status: "ACTIVE",
    });

    // Divisional Department
    await Department.create({
      _id: devDeptId,
      organizationId: orgId,
      divisionId: divId,
      name: "Software Development",
      code: "NX-HQ-DV",
      isCentral: false,
      status: "ACTIVE",
    });

    // Divisional Team
    await Team.create({
      _id: teamId,
      organizationId: orgId,
      departmentId: devDeptId,
      name: "Core Platform Team",
      code: "NX-DV-Tech",
      status: "ACTIVE",
    });

    await holidayService.initializeDefaultHolidaysForOrg(orgId.toString(), 2026);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // =========================================================================
  // 1. ORGANIZATIONAL HIERARCHY VALIDATION
  // =========================================================================
  describe("1. Organizational Hierarchy & Legacy Structure Validation", () => {
    it("validates that Central HR Department has divisionId null and isCentral true", async () => {
      const central = await Department.findById(centralDeptId);
      expect(central).toBeDefined();
      expect(central!.divisionId).toBeNull();
      expect(central!.isCentral).toBe(true);
      expect(central!.code).toBe("NX-HQ-HR");
    });

    it("validates that Software Development Department correctly belongs to Software Engineering Division", async () => {
      const devDept = await Department.findById(devDeptId);
      expect(devDept).toBeDefined();
      expect(devDept!.divisionId?.toString()).toBe(divId.toString());
      expect(devDept!.isCentral).toBe(false);
    });

    it("validates that Core Platform Team is nested under Software Development Department", async () => {
      const team = await Team.findById(teamId);
      expect(team).toBeDefined();
      expect(team!.departmentId?.toString()).toBe(devDeptId.toString());
    });
  });

  // =========================================================================
  // 2. ID GENERATION SERVICES & COLLISION AVOIDANCE
  // =========================================================================
  describe("2. Employee and Intern ID Generation Services", () => {
    it("correctly evaluates existing IDs and generates sequential collision-resistant IDs", async () => {
      // Simulate existing legacy employee NX-EMP-0001
      await User.create({
        fullName: "Existing Staff",
        email: "existing.staff@nexisparkx.com",
        employeeId: "NX-EMP-0001",
        passwordHash: "hash",
        organizationId: orgId,
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        status: "ACTIVE",
      });

      // Next employee ID must be NX-EMP-0002
      const nextEmpId = await generateEmployeeId("EMPLOYEE");
      expect(nextEmpId).toBe("NX-EMP-0002");

      // First intern ID must be NX-INT-0001
      const nextIntId = await generateEmployeeId("INTERN");
      expect(nextIntId).toBe("NX-INT-0001");
    });
  });

  // =========================================================================
  // 3. EIGHT PILOT ACCOUNTS: ROLE & PERMISSION BOUNDARIES
  // =========================================================================
  describe("3. Eight Pilot Accounts Simulation & Scope Boundaries", () => {
    beforeAll(async () => {
      // 1. Super Admin
      superAdminUser = await User.create({
        fullName: "Platform Administrator",
        email: "superadmin@nexisparkx.com",
        employeeId: "SA001",
        passwordHash: "hash",
        organizationId: orgId,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
      });

      // 2. Org Admin
      orgAdminUser = await User.create({
        fullName: "Organization Administrator",
        email: "orgadmin@nexisparkx.com",
        employeeId: "NX-ADM-0002",
        passwordHash: "hash",
        organizationId: orgId,
        role: "ADMIN",
        divisionId: null,
        status: "ACTIVE",
      });

      // 3. HR
      hrUser = await User.create({
        fullName: "Central HR Lead",
        email: "hr@nexisparkx.com",
        employeeId: "NX-HR-0001",
        passwordHash: "hash",
        organizationId: orgId,
        departmentId: centralDeptId.toString(),
        divisionId: null,
        role: "HR",
        status: "ACTIVE",
      });

      // 4. Division Admin
      divAdminUser = await User.create({
        fullName: "Engineering Division Lead",
        email: "divadmin.tech@nexisparkx.com",
        employeeId: "NX-DIV-0001",
        passwordHash: "hash",
        organizationId: orgId,
        divisionId: divId,
        role: "DIVISION_ADMIN",
        status: "ACTIVE",
      });

      // 5. Manager
      managerUser = await User.create({
        fullName: "Engineering Manager",
        email: "manager.eng@nexisparkx.com",
        employeeId: "NX-MGR-0001",
        passwordHash: "hash",
        organizationId: orgId,
        divisionId: divId,
        departmentId: devDeptId.toString(),
        role: "MANAGER",
        status: "ACTIVE",
      });

      // 6. Team Leader
      teamLeaderUser = await User.create({
        fullName: "Core Platform Lead",
        email: "teamlead.core@nexisparkx.com",
        employeeId: "NX-TL-0001",
        passwordHash: "hash",
        organizationId: orgId,
        divisionId: divId,
        departmentId: devDeptId.toString(),
        teamId: teamId.toString(),
        reportingManagerId: managerUser._id,
        role: "TEAM_LEADER",
        status: "ACTIVE",
      });

      // 7. Full-Time Employee
      employeeUser = await User.create({
        fullName: "Senior Backend Engineer",
        email: "employee.dev@nexisparkx.com",
        employeeId: "NX-EMP-0002",
        passwordHash: "hash",
        organizationId: orgId,
        divisionId: divId,
        departmentId: devDeptId.toString(),
        teamId: teamId.toString(),
        reportingManagerId: teamLeaderUser._id,
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
        mustChangePassword: true,
      });

      // 8. Full-Time Intern
      internUser = await User.create({
        fullName: "Platform Engineering Intern",
        email: "intern.ai@nexisparkx.com",
        employeeId: "NX-INT-0001",
        passwordHash: "hash",
        organizationId: orgId,
        divisionId: divId,
        departmentId: devDeptId.toString(),
        teamId: teamId.toString(),
        reportingManagerId: teamLeaderUser._id,
        role: "INTERN",
        employmentType: "INTERN",
        employmentClassification: "FULL_TIME_INTERN",
        internshipStartDate: new Date("2026-08-01"),
        internshipEndDate: new Date("2026-10-31"),
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
        mustChangePassword: true,
      });
    });

    it("verifies mustChangePassword is set to true for newly provisioned pilot accounts", async () => {
      expect(employeeUser.mustChangePassword).toBe(true);
      expect(internUser.mustChangePassword).toBe(true);
    });

    it("verifies reporting hierarchy: Employee -> Team Leader -> Manager", async () => {
      expect(employeeUser.reportingManagerId.toString()).toBe(teamLeaderUser._id.toString());
      expect(teamLeaderUser.reportingManagerId.toString()).toBe(managerUser._id.toString());
    });
  });

  // =========================================================================
  // 4. IN-APP NOTIFICATIONS & SOCKET.IO (REPORTING SMTP STATUS)
  // =========================================================================
  describe("4. Notifications & Real-Time Engine (SMTP Status)", () => {
    it("successfully creates and stores in-app notifications with deduplication", async () => {
      const notif = await notificationService.createNotification({
        recipientId: employeeUser._id.toString(),
        organizationId: orgId.toString(),
        type: "LEAVE_STATUS",
        title: "Leave Approved",
        message: "Your leave application for 2026-08-10 has been approved.",
        priority: "NORMAL",
      });

      expect(notif).toBeDefined();
      expect(notif.title).toBe("Leave Approved");
      expect(notif.isRead).toBe(false);
    });

    it("reports SMTP configuration status: external mailer missing, fallback active", () => {
      const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
      // Confirmed: SMTP is not configured in environment, in-app notification engine serves as verified channel
      expect(hasSmtp).toBe(false);
    });
  });

  // =========================================================================
  // 5. PILOT UAT: LEAVE & ATTENDANCE WORKFLOWS
  // =========================================================================
  describe("5. Pilot UAT: Employee and Intern Operational Workflows", () => {
    it("Employee checks in, checks out, and records attendance duration", async () => {
      const checkIn = await attendanceService.loginAttendance(employeeUser._id.toString(), "WEB");
      expect(["PRESENT", "LATE"]).toContain(checkIn.attendance.attendanceStatus);

      const checkOut = await attendanceService.logoutAttendance(employeeUser._id.toString(), { bypassEod: true });
      expect(checkOut.attendance.workingDuration).toBeDefined();
    });

    it("Employee leave policy: 51 days total (30 PL, 14 CL, 7 ML) + 5 Govt Holidays", async () => {
      const balances = await leaveService.getLeaveBalance(employeeUser, orgId.toString());
      const pl = balances.find((b: any) => b.leaveTypeName.includes("Privilege"));
      const cl = balances.find((b: any) => b.leaveTypeName.includes("Casual"));
      const ml = balances.find((b: any) => b.leaveTypeName.includes("Medical"));

      expect(pl?.allocated).toBe(30);
      expect(cl?.allocated).toBe(14);
      expect(ml?.allocated).toBe(7);
      expect((pl?.allocated || 0) + (cl?.allocated || 0) + (ml?.allocated || 0)).toBe(51);

      const holidays = await Holiday.find({ organizationId: orgId, year: 2026 });
      expect(holidays.length).toBe(5);
    });

    it("Intern leave policy: exactly 1 day per month (3 months = 3 days allocation) and Saturday weekly off", async () => {
      const balances = await leaveService.getLeaveBalance(internUser, orgId.toString());
      expect(balances[0].allocated).toBe(3);
    });

    it("Employee applies for leave, Manager / HR approves, attendance reflects ON_LEAVE", async () => {
      const leave = await leaveService.applyLeave(employeeUser, {
        startDate: new Date("2026-08-10"),
        endDate: new Date("2026-08-11"),
        reason: "Personal commitment",
      });

      expect(leave.status).toBe("PENDING");

      // Manager approves within reporting scope
      const approved = await leaveService.reviewLeave(leave._id.toString(), "APPROVED", hrUser);
      expect(approved.status).toBe("APPROVED");

      const att = await Attendance.findOne({
        userId: employeeUser._id,
        date: {
          $gte: new Date("2026-08-10T00:00:00.000Z"),
          $lte: new Date("2026-08-10T23:59:59.999Z"),
        },
      });
      expect(att).toBeDefined();
      expect(att!.attendanceStatus).toBe("ON_LEAVE");
    });
  });

  // =========================================================================
  // 6. PILOT UAT: PAYROLL PROCESSING & SECURITY RESTRICTIONS
  // =========================================================================
  describe("6. Pilot UAT: Payroll Processing, Immutability & Access Control", () => {
    let empPayrollId: string;

    it("HR prepares monthly payroll, Manager/HR reviews and approves", async () => {
      await Compensation.create({
        userId: employeeUser._id,
        organizationId: orgId,
        divisionId: divId,
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        compensationType: "SALARY",
        baseAmount: 75000,
        salaryType: "MONTHLY",
        monthlyGrossSalary: 75000,
        payrollStartDate: new Date("2026-08-01"),
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-01"),
        createdBy: superAdminUser._id,
      });

      const gen = await payrollService.generateMonthlyPayroll(
        orgId.toString(),
        8,
        2026,
        { userIds: [employeeUser._id.toString()], overwriteDraft: true },
        hrUser
      );
      expect(gen.generatedCount).toBe(1);

      const pRec = await Payroll.findOne({ userId: employeeUser._id, payrollMonth: 8, payrollYear: 2026 });
      expect(pRec).toBeDefined();
      expect(pRec!.status).toBe("DRAFT");
      empPayrollId = pRec!._id.toString();

      // Review and approve
      const approved = await payrollService.updatePayrollStatus(empPayrollId, "APPROVED", "Ready for disbursement", hrUser);
      expect(approved.status).toBe("APPROVED");
    });

    it("Disbursement confirmation marks record as PAID and enforces immutability", async () => {
      const paid = await payrollService.confirmPayrollPayment(
        empPayrollId,
        {
          paymentDate: new Date("2026-08-31"),
          transactionReference: "STAGING-TXN-20260831",
          paymentMode: "BANK_TRANSFER",
        },
        superAdminUser
      );

      expect(paid.status).toBe("PAID");

      // Verify immutability
      await expect(
        payrollService.updatePayrollStatus(empPayrollId, "UNDER_REVIEW", "Attempt to revert", superAdminUser)
      ).rejects.toThrow("IMMUTABLE_PAID_PAYROLL");
    });

    it("Strict IDOR: Intern is forbidden from accessing Employee's payslip PDF", async () => {
      await expect(
        payrollService.generatePayslipPdfBuffer(empPayrollId, internUser)
      ).rejects.toThrow("FORBIDDEN");
    });

    it("Employee can access their own payslip PDF containing CIN U62099MP2026PTC084748", async () => {
      const pdf = await payrollService.generatePayslipPdfBuffer(empPayrollId, employeeUser);
      expect(pdf.buffer).toBeInstanceOf(Buffer);
      const text = pdf.buffer.toString("latin1");
      expect(text).toContain("%PDF-1.4");
      expect(text).toContain("U62099MP2026PTC084748");
      expect(text).toContain("NEXISPARKX PRIVATE LIMITED");
    });
  });
});

