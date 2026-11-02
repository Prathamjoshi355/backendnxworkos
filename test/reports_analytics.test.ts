import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User";
import Attendance from "../src/models/Attendance";
import Task from "../src/models/Task";
import DailyReport from "../src/models/DailyReport";
import Leave from "../src/models/Leave";
import Project from "../src/models/Project";
import Meeting from "../src/models/Meeting";
import Compensation from "../src/models/Compensation";
import { PointTransaction } from "../src/models/PointTransaction";
import * as reportService from "../src/services/reportService";
import { parseReportDateRange, calculateDelta } from "../src/utils/dateRangeHelper";

describe("Reports & Analytics Service Tests", () => {
  let mongoServer: MongoMemoryServer;

  const org1Id = new mongoose.Types.ObjectId();
  const org2Id = new mongoose.Types.ObjectId();

  const superAdminUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Global Super Admin",
    email: "superadmin@nx.com",
    role: "SUPER_ADMIN",
  };

  const adminUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Org1 Admin",
    email: "admin@org1.com",
    role: "ADMIN",
    organizationId: org1Id,
  };

  const hrUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Org1 HR Manager",
    email: "hr@org1.com",
    role: "HR",
    organizationId: org1Id,
  };

  const employeeUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Alice Worker",
    email: "alice@org1.com",
    role: "EMPLOYEE",
    organizationId: org1Id,
  };

  const employee2User = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Bob Builder",
    email: "bob@org1.com",
    role: "EMPLOYEE",
    organizationId: org1Id,
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    // Seed test users
    await User.create([
      {
        _id: adminUser._id,
        fullName: adminUser.fullName,
        email: adminUser.email,
        role: "ADMIN",
        organizationId: org1Id,
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
        employmentType: "EMPLOYEE",
        passwordHash: "hash123",
      },
      {
        _id: hrUser._id,
        fullName: hrUser.fullName,
        email: hrUser.email,
        role: "HR",
        organizationId: org1Id,
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
        employmentType: "EMPLOYEE",
        passwordHash: "hash123",
      },
      {
        _id: employeeUser._id,
        fullName: employeeUser.fullName,
        email: employeeUser.email,
        role: "EMPLOYEE",
        organizationId: org1Id,
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
        employmentType: "EMPLOYEE",
        employeeId: "EMP-001",
        passwordHash: "hash123",
      },
      {
        _id: employee2User._id,
        fullName: employee2User.fullName,
        email: employee2User.email,
        role: "EMPLOYEE",
        organizationId: org1Id,
        status: "PROBATION",
        employmentStatus: "PROBATION",
        employmentType: "EMPLOYEE",
        employeeId: "EMP-002",
        passwordHash: "hash123",
      },
    ]);

    const now = new Date();

    // Seed Attendance
    await Attendance.create([
      {
        userId: employeeUser._id,
        organizationId: org1Id,
        date: now,
        attendanceStatus: "PRESENT",
        loginAt: now,
        totalWorkDuration: 480,
        totalBreakDuration: 60,
      },
      {
        userId: employee2User._id,
        organizationId: org1Id,
        date: now,
        attendanceStatus: "LATE",
        loginAt: now,
        totalWorkDuration: 420,
        totalBreakDuration: 45,
      },
    ]);

    // Seed Tasks
    await Task.create([
      {
        taskId: "TASK-001",
        title: "Build Core Engine",
        organizationId: org1Id,
        assignedTo: employeeUser._id,
        assignedBy: adminUser._id,
        status: "COMPLETED",
        priority: "HIGH",
        actualMinutes: 240,
        approvalStatus: "APPROVED",
        createdAt: now,
      },
      {
        taskId: "TASK-002",
        title: "Write Documentation",
        organizationId: org1Id,
        assignedTo: employeeUser._id,
        assignedBy: adminUser._id,
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        actualMinutes: 120,
        createdAt: now,
      },
      {
        taskId: "TASK-003",
        title: "Fix Navigation Bug",
        organizationId: org1Id,
        assignedTo: employee2User._id,
        assignedBy: adminUser._id,
        status: "COMPLETED",
        priority: "URGENT",
        actualMinutes: 60,
        approvalStatus: "APPROVED",
        createdAt: now,
      },
    ]);

    // Seed EOD Report
    await DailyReport.create([
      {
        userId: employeeUser._id,
        organizationId: org1Id,
        reportDate: now,
        status: "APPROVED",
        tasksCompletedCount: 2,
        totalWorkedMinutes: 480,
        summary: "Completed all scheduled items",
      },
    ]);

    // Seed Leave
    await Leave.create([
      {
        userId: employeeUser._id,
        organizationId: org1Id,
        leaveTypeName: "Casual Leave",
        startDate: now,
        endDate: now,
        totalDays: 1,
        status: "APPROVED",
        reason: "Personal appointment",
      },
    ]);

    // Seed Project
    await Project.create([
      {
        projectId: "PROJ-001",
        code: "NXCORE",
        name: "NX Core Platform",
        organizationId: org1Id,
        ownerId: adminUser._id,
        createdBy: adminUser._id,
        status: "ACTIVE",
        progress: 75,
        members: [employeeUser._id, employee2User._id],
      },
    ]);

    // Seed Meeting
    await Meeting.create([
      {
        meetingId: "MEET-001",
        title: "Sprint Planning",
        organizationId: org1Id,
        organizerId: adminUser._id,
        date: now,
        startTime: "10:00",
        endTime: "11:00",
        status: "COMPLETED",
        meetingType: "ONLINE",
        participants: [{ userId: employeeUser._id, responseStatus: "ACCEPTED" }],
      },
    ]);

    // Seed Point Transactions
    await PointTransaction.create([
      {
        userId: employeeUser._id,
        organizationId: org1Id,
        points: 50,
        type: "EARNED",
        sourceType: "TASK",
        reason: "Completed priority task",
      },
    ]);

    // Seed Compensation
    await Compensation.create([
      {
        userId: employeeUser._id,
        organizationId: org1Id,
        employmentType: "EMPLOYEE",
        compensationType: "SALARY",
        baseAmount: 120000,
        currency: "INR",
        payFrequency: "MONTHLY",
        status: "ACTIVE",
        effectiveFrom: new Date("2025-01-01"),
        createdBy: adminUser._id,
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("Date Range Helper & Delta Calculations", () => {
    it("parses deterministic date ranges for today, yesterday, and month presets", () => {
      const today = parseReportDateRange("today");
      expect(today.current.start).toBeDefined();
      expect(today.current.end).toBeDefined();
      expect(today.previous.start).toBeDefined();

      const thisMonth = parseReportDateRange("this_month");
      expect(thisMonth.current.start.getDate()).toBe(1);

      const custom = parseReportDateRange("custom", "2026-01-01", "2026-01-31");
      expect(custom.current.start.getFullYear()).toBe(2026);
      expect(custom.current.end.getDate()).toBe(31);
    });

    it("calculates deltas safely without division-by-zero errors", () => {
      const d1 = calculateDelta(120, 100);
      expect(d1.percentage).toBe(20);
      expect(d1.isPositive).toBe(true);

      const d2 = calculateDelta(50, 0);
      expect(d2.percentage).toBe(100);
      expect(d2.isPositive).toBe(true);

      const d3 = calculateDelta(0, 0);
      expect(d3.percentage).toBe(0);
    });
  });

  describe("Executive Organization Overview Report", () => {
    it("returns executive KPIs and period comparison for Admin", async () => {
      const report = await reportService.getOverviewReport(adminUser, { dateRange: "this_month" });

      expect(report.category).toBe("overview");
      expect(report.scope).toBe("ORGANIZATION");
      expect(report.kpis.totalEmployees.current).toBeGreaterThanOrEqual(3);
      expect(report.kpis.activeEmployees.current).toBeGreaterThanOrEqual(2);
      expect(report.kpis.attendanceRate.current).toBe(100);
      expect(report.kpis.taskCompletionRate.current).toBeGreaterThan(0);
      expect(report.kpis.activeProjects.current).toBe(1);
    });

    it("scopes overview report to personal metrics for regular employee", async () => {
      const report = await reportService.getOverviewReport(employeeUser, { dateRange: "this_month" });

      expect(report.category).toBe("overview");
      expect(report.scope).toBe("PERSONAL");
      expect(report.kpis.totalTasks.current).toBe(2);
      expect(report.kpis.presentDays.current).toBe(1);
    });
  });

  describe("Domain Category Reports", () => {
    it("generates Employee 360° report with attendance, tasks, EOD, and points", async () => {
      const report = await reportService.getEmployeesReport(adminUser, { dateRange: "this_month" });

      expect(report.category).toBe("employees");
      expect(report.total).toBeGreaterThanOrEqual(2);
      const alice = report.items.find((i: any) => i.fullName === "Alice Worker");
      expect(alice).toBeDefined();
      expect(alice.tasks.assigned).toBe(2);
      expect(alice.tasks.completed).toBe(1);
      expect(alice.attendance.presentDays).toBe(1);
      expect(alice.eodSubmissions).toBe(1);
      expect(alice.pointsEarned).toBe(50);
    });

    it("generates Attendance report with work/break duration and rate", async () => {
      const report = await reportService.getAttendanceReport(adminUser, { dateRange: "this_month" });

      expect(report.category).toBe("attendance");
      expect(report.summary.presentCount).toBe(2);
      expect(report.summary.lateCount).toBe(1);
      expect(report.summary.attendanceRate).toBe(100);
      expect(report.summary.totalWorkHours).toBe(15); // (480 + 420) / 60
    });

    it("generates Tasks report with status and priority distribution", async () => {
      const report = await reportService.getTasksReport(adminUser, { dateRange: "this_month" });

      expect(report.category).toBe("tasks");
      expect(report.summary.total).toBe(3);
      expect(report.summary.completed).toBe(2);
      expect(report.summary.inProgress).toBe(1);
      expect(report.summary.approvalRate).toBe(100);
      expect(report.priorityBreakdown["HIGH"]).toBe(1);
      expect(report.priorityBreakdown["URGENT"]).toBe(1);
    });

    it("generates EOD report with submission counts and hours", async () => {
      const report = await reportService.getEodReport(adminUser, { dateRange: "this_month" });

      expect(report.category).toBe("eod");
      expect(report.summary.totalReports).toBe(1);
      expect(report.summary.approvedCount).toBe(1);
      expect(report.summary.totalHoursReported).toBe(8);
    });

    it("generates Leave report with type breakdown", async () => {
      const report = await reportService.getLeaveReport(adminUser, { dateRange: "this_month" });

      expect(report.category).toBe("leave");
      expect(report.summary.totalRequests).toBe(1);
      expect(report.summary.approvedCount).toBe(1);
      expect(report.byType["Casual Leave"]).toBeDefined();
    });

    it("generates Project and Meeting reports", async () => {
      const projReport = await reportService.getProjectsReport(adminUser, {});
      expect(projReport.category).toBe("projects");
      expect(projReport.summary.totalProjects).toBe(1);
      expect(projReport.summary.activeProjects).toBe(1);

      const meetingReport = await reportService.getMeetingsReport(adminUser, { dateRange: "this_month" });
      expect(meetingReport.category).toBe("meetings");
      expect(meetingReport.summary.totalMeetings).toBe(1);
      expect(meetingReport.summary.completedMeetings).toBe(1);
    });

    it("generates HR report with workforce lifecycle counts", async () => {
      const hrReport = await reportService.getHrReport(adminUser, { dateRange: "this_month" });

      expect(hrReport.category).toBe("hr");
      expect(hrReport.summary.totalHeadcount).toBeGreaterThanOrEqual(3);
      expect(hrReport.summary.activeCount).toBeGreaterThanOrEqual(2);
      expect(hrReport.summary.probationCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Security & RBAC Protection", () => {
    it("allows HR and Admin to access Compensation reports", async () => {
      const compReport = await reportService.getCompensationReport(adminUser, { dateRange: "this_month" });

      expect(compReport.category).toBe("compensation");
      expect(compReport.summary.totalActiveCompensations).toBe(1);
      expect(compReport.summary.totalMonthlyPayroll).toBe(120000);
    });

    it("rejects regular employee from accessing Compensation reports with 403 Forbidden", async () => {
      await expect(
        reportService.getCompensationReport(employeeUser, { dateRange: "this_month" })
      ).rejects.toThrow("FORBIDDEN_COMPENSATION_REPORT");
    });

    it("prevents cross-organization data leakage", async () => {
      // Create user for org2
      const org2Admin = {
        _id: new mongoose.Types.ObjectId(),
        fullName: "Org2 Admin",
        email: "admin@org2.com",
        role: "ADMIN",
        organizationId: org2Id,
      };

      const report = await reportService.getOverviewReport(org2Admin, { dateRange: "this_month" });
      expect(report.kpis.totalEmployees.current).toBe(0);
      expect(report.kpis.activeProjects.current).toBe(0);
    });

    it("rejects invalid report category", async () => {
      await expect(
        reportService.getCategoryReport("unsupported_category", adminUser, {})
      ).rejects.toThrow("INVALID_REPORT_CATEGORY");
    });
  });

  describe("CSV Export Engine", () => {
    it("serializes employees report to valid RFC-4180 CSV with UTF-8 BOM", async () => {
      const exportRes = await reportService.exportReportCsv("employees", adminUser, { dateRange: "this_month" });

      expect(exportRes.filename).toContain("employees_report_");
      expect(exportRes.filename.endsWith(".csv")).toBe(true);
      expect(exportRes.csv.startsWith("\uFEFF")).toBe(true);
      expect(exportRes.csv).toContain("Employee ID,Full Name,Email,Designation");
      expect(exportRes.csv).toContain("Alice Worker");
    });

    it("serializes attendance report to valid CSV", async () => {
      const exportRes = await reportService.exportReportCsv("attendance", adminUser, { dateRange: "this_month" });

      expect(exportRes.filename).toContain("attendance_report_");
      expect(exportRes.csv).toContain("Date,Employee,Employee ID,Status");
      expect(exportRes.csv).toContain("PRESENT");
    });
  });
});
