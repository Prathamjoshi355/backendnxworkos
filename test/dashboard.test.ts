import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Attendance from "../src/models/Attendance";
import WorkSession from "../src/models/WorkSession";
import Task from "../src/models/Task";
import DailyReport from "../src/models/DailyReport";
import Leave from "../src/models/Leave";
import Project from "../src/models/Project";
import Meeting from "../src/models/Meeting";
import Conversation from "../src/models/Conversation";
import { PerformanceSnapshot } from "../src/models/PerformanceSnapshot";
import { PointTransaction } from "../src/models/PointTransaction";
import Compensation from "../src/models/Compensation";
import * as dashboardService from "../src/services/dashboardService";

describe("Dashboard 2.0 Orchestration & Service Tests", () => {
  let mongoServer: MongoMemoryServer;

  const org1Id = new mongoose.Types.ObjectId();
  const org2Id = new mongoose.Types.ObjectId();

  const superAdminUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Executive Super Admin",
    email: "superadmin@nx.com",
    role: "SUPER_ADMIN",
  };

  const adminUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Operations Admin",
    email: "admin@org1.com",
    role: "ADMIN",
    organizationId: org1Id,
  };

  const managerUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Engineering Manager",
    email: "manager@org1.com",
    role: "MANAGER",
    organizationId: org1Id,
  };

  const employeeUser = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Alice Developer",
    email: "alice@org1.com",
    role: "EMPLOYEE",
    organizationId: org1Id,
  };

  const employee2User = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Bob Engineer",
    email: "bob@org1.com",
    role: "EMPLOYEE",
    organizationId: org1Id,
  };

  const org2Employee = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Charlie Tenant",
    email: "charlie@org2.com",
    role: "EMPLOYEE",
    organizationId: org2Id,
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    // Create Organizations
    await Organization.create([
      { _id: org1Id, name: "Nexus Corp", code: "NEX", status: "ACTIVE" },
      { _id: org2Id, name: "Acme Industries", code: "ACM", status: "ACTIVE" },
    ]);

    // Create Users
    await User.create([
      { ...superAdminUser, passwordHash: "dummy", status: "ACTIVE" },
      { ...adminUser, passwordHash: "dummy", status: "ACTIVE" },
      { ...managerUser, passwordHash: "dummy", status: "ACTIVE" },
      { ...employeeUser, passwordHash: "dummy", status: "ACTIVE", employmentType: "EMPLOYEE" },
      { ...employee2User, passwordHash: "dummy", status: "PROBATION", employmentType: "EMPLOYEE" },
      { ...org2Employee, passwordHash: "dummy", status: "ACTIVE", employmentType: "EMPLOYEE" },
    ]);

    const now = new Date();

    // 1. Attendance & WorkSession for Employee 1 (Online)
    const todayAtt = await Attendance.create({
      userId: employeeUser._id,
      organizationId: org1Id,
      date: now,
      attendanceStatus: "PRESENT",
      firstLoginAt: new Date(now.getTime() - 180 * 60000),
      totalWorkDuration: 180 * 60000,
      totalBreakDuration: 20 * 60000,
    });

    await WorkSession.create({
      userId: employeeUser._id,
      attendanceId: todayAtt._id,
      loginAt: new Date(now.getTime() - 180 * 60000),
      status: "ACTIVE",
      duration: 180 * 60000,
    });

    // 2. Tasks for Employee 1
    await Task.create([
      {
        taskId: "TSK-001",
        title: "Urgent API Fix",
        organizationId: org1Id,
        assignedTo: employeeUser._id,
        assignedBy: adminUser._id,
        status: "IN_PROGRESS",
        priority: "HIGH",
        dueDate: new Date(now.getTime() + 86400000),
        isDeleted: false,
      },
      {
        taskId: "TSK-002",
        title: "Overdue Database Migration",
        organizationId: org1Id,
        assignedTo: employeeUser._id,
        assignedBy: adminUser._id,
        status: "IN_PROGRESS",
        priority: "URGENT",
        dueDate: new Date(now.getTime() - 86400000), // Overdue!
        isDeleted: false,
      },
      {
        taskId: "TSK-003",
        title: "Completed Unit Tests",
        organizationId: org1Id,
        assignedTo: employeeUser._id,
        assignedBy: adminUser._id,
        status: "COMPLETED",
        priority: "MEDIUM",
        dueDate: new Date(now.getTime() - 172800000),
        isDeleted: false,
      },
    ]);

    // 3. Performance Snapshot & Points
    await PerformanceSnapshot.create({
      userId: employeeUser._id,
      organizationId: org1Id,
      periodType: "MONTHLY",
      periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
      periodEnd: now,
      performanceScore: 92,
      taskCompletionScore: 90,
      timelinessScore: 88,
      attendanceScore: 95,
      targetScore: 90,
      consistencyScore: 90,
      productivityScore: 92,
      calculationVersion: 1,
      calculatedAt: now,
    });

    await PointTransaction.create({
      userId: employeeUser._id,
      organizationId: org1Id,
      type: "EARNED",
      points: 150,
      sourceType: "TASK",
      reason: "Completed high priority task",
    });

    // 4. Pending Leave Request for Employee 2
    await Leave.create({
      userId: employee2User._id,
      organizationId: org1Id,
      leaveTypeName: "Casual Leave",
      startDate: new Date(now.getTime() + 86400000 * 3),
      endDate: new Date(now.getTime() + 86400000 * 5),
      totalDays: 2,
      reason: "Family vacation",
      status: "PENDING",
    });

    // 5. Active Project
    await Project.create({
      projectId: "PRJ-101",
      name: "NXWorkOS 2.0",
      code: "NX2",
      organizationId: org1Id,
      ownerId: adminUser._id,
      createdBy: adminUser._id,
      members: [employeeUser._id],
      status: "ACTIVE",
      priority: "HIGH",
      progress: 65,
      dueDate: new Date(now.getTime() + 86400000 * 14),
    });

    // 6. Upcoming Meeting
    await Meeting.create({
      meetingId: "MTG-201",
      title: "Sprint Planning",
      organizationId: org1Id,
      organizerId: managerUser._id,
      participants: [
        { userId: employeeUser._id, responseStatus: "ACCEPTED" },
        { userId: adminUser._id, responseStatus: "ACCEPTED" },
      ],
      meetingType: "ONLINE",
      date: now,
      startTime: "15:00",
      endTime: "16:00",
      status: "SCHEDULED",
    });

    // 7. Compensation record for Org 1
    await Compensation.create({
      userId: employeeUser._id,
      organizationId: org1Id,
      compensationType: "SALARY",
      employmentType: "EMPLOYEE",
      baseAmount: 85000,
      currency: "INR",
      payFrequency: "MONTHLY",
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-01"),
      createdBy: adminUser._id,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("Employee Dashboard 2.0", () => {
    it("aggregates today work, tasks, performance, and deterministic alerts for employee", async () => {
      const dashboard = await dashboardService.getDashboard(employeeUser, { period: "today" });

      expect(dashboard).toBeDefined();
      expect(dashboard.role).toBe("EMPLOYEE");
      expect(dashboard.scope.level).toBe("PERSONAL");

      // Today's work session
      expect(dashboard.todayWork).toBeDefined();
      expect(dashboard.todayWork.workStatus).toBe("ONLINE");
      expect(dashboard.todayWork.attendanceStatus).toBe("PRESENT");
      expect(dashboard.todayWork.hasActiveSession).toBe(true);

      // Tasks
      expect(dashboard.tasks).toBeDefined();
      expect(dashboard.tasks.total).toBe(3);
      expect(dashboard.tasks.pending).toBe(2);
      expect(dashboard.tasks.overdue).toBe(1);
      expect(dashboard.tasks.completed).toBe(1);

      // Performance & Points
      expect(dashboard.performance).toBeDefined();
      expect(dashboard.performance.score).toBe(92);
      expect(dashboard.performance.points).toBe(150);
      expect(dashboard.performance.eodSubmitted).toBe(false);

      // Deterministic alerts generated
      expect(dashboard.alerts).toBeDefined();
      expect(dashboard.alerts.some((a) => a.id === "alert-emp-overdue")).toBe(true);
      expect(dashboard.alerts.some((a) => a.id === "alert-emp-eod")).toBe(true);

      // Quick Actions
      expect(dashboard.quickActions).toBeDefined();
      expect(dashboard.quickActions.some((q) => q.actionKey === "start_break")).toBe(true);
      expect(dashboard.quickActions.some((q) => q.actionKey === "check_out")).toBe(true);
      expect(dashboard.quickActions.some((q) => q.actionKey === "submit_eod")).toBe(true);

      // Privacy: No compensation data leaked to employee
      expect((dashboard as any).compensation).toBeUndefined();
    });
  });

  describe("Admin / Manager Dashboard 2.0", () => {
    it("aggregates workforce telemetry, operational pipeline, and team performance", async () => {
      const dashboard = await dashboardService.getDashboard(adminUser, { period: "this_month" });

      expect(dashboard).toBeDefined();
      expect(dashboard.role).toBe("ADMIN");
      expect(dashboard.scope.level).toBe("ORGANIZATION");

      // Workforce KPIs
      expect(dashboard.workforce).toBeDefined();
      expect(dashboard.workforce.total).toBeGreaterThanOrEqual(2);
      expect(dashboard.workforce.online).toBeGreaterThanOrEqual(1);

      // Task Operations
      expect(dashboard.taskOperations).toBeDefined();
      expect(dashboard.taskOperations.total).toBe(3);
      expect(dashboard.taskOperations.overdue).toBe(1);

      // Team Performance
      expect(dashboard.teamPerformance).toBeDefined();
      expect(dashboard.teamPerformance.averageScore).toBeGreaterThan(0);
      expect(dashboard.teamPerformance.topPerformers.length).toBeGreaterThanOrEqual(1);

      // Leave Operations
      expect(dashboard.leaveOperations).toBeDefined();
      expect(dashboard.leaveOperations.pendingCount).toBe(1);
      expect(dashboard.leaveOperations.pendingRequests[0].leaveTypeName).toBe("Casual Leave");

      // Deterministic operational alerts
      expect(dashboard.alerts).toBeDefined();
      expect(dashboard.alerts.some((a) => a.id === "alert-admin-leaves")).toBe(true);
      expect(dashboard.alerts.some((a) => a.id === "alert-admin-overdue")).toBe(true);

      // HR Lifecycle highlights
      expect(dashboard.hr).toBeDefined();
      expect(dashboard.hr.probationCount).toBe(1); // employee2User is on probation
    });
  });

  describe("Super Admin Executive Dashboard 2.0", () => {
    it("aggregates multi-organization comparisons, executive KPIs, and role-gated compensation", async () => {
      const dashboard = await dashboardService.getDashboard(superAdminUser, { period: "this_month" });

      expect(dashboard).toBeDefined();
      expect(dashboard.role).toBe("SUPER_ADMIN");
      expect(dashboard.scope.level).toBe("GLOBAL");

      // Executive KPIs
      expect(dashboard.kpis).toBeDefined();
      expect(dashboard.kpis.some((k) => k.label === "Total Organizations")).toBe(true);
      expect(dashboard.kpis.some((k) => k.label === "Global Workforce")).toBe(true);

      // Multi-Organization Comparison
      expect(dashboard.organizationComparison).toBeDefined();
      expect(dashboard.organizationComparison.length).toBe(2);
      expect(dashboard.organizationComparison.some((o) => o.name === "Nexus Corp")).toBe(true);
      expect(dashboard.organizationComparison.some((o) => o.name === "Acme Industries")).toBe(true);

      // Role-Gated Compensation Cost
      expect(dashboard.compensation).toBeDefined();
      expect(dashboard.compensation.monthlyPayrollCost).toBe(85000);

      // Quick actions
      expect(dashboard.quickActions.some((q) => q.actionKey === "manage_orgs")).toBe(true);
      expect(dashboard.quickActions.some((q) => q.actionKey === "manage_access")).toBe(true);
    });

    it("filters executive dashboard by specific organizationId when requested", async () => {
      const dashboard = await dashboardService.getDashboard(superAdminUser, {
        period: "this_month",
        organizationId: String(org1Id),
      });

      expect(dashboard).toBeDefined();
      expect(dashboard.scope.filteredOrgId).toBe(String(org1Id));
      expect(dashboard.compensation).toBeDefined();
      expect(dashboard.compensation.monthlyPayrollCost).toBe(85000);
    });
  });

  describe("Security, Scoping & Edge Cases", () => {
    it("handles empty database queries safely without division-by-zero", async () => {
      const emptyUser = {
        _id: new mongoose.Types.ObjectId(),
        fullName: "Empty User",
        email: "empty@org2.com",
        role: "EMPLOYEE",
        organizationId: org2Id,
      };

      const dashboard = await dashboardService.getDashboard(emptyUser, { period: "today" });

      expect(dashboard).toBeDefined();
      expect(dashboard.tasks.total).toBe(0);
      expect(dashboard.tasks.completionRate).toBe(100);
      expect(dashboard.todayWork.attendanceStatus).toBe("ABSENT");
      expect(dashboard.performance.score).toBe(100);
    });

    it("supports custom date range parameters", async () => {
      const dashboard = await dashboardService.getDashboard(adminUser, {
        period: "custom",
        startDate: "2026-01-01",
        endDate: "2026-03-01",
      });

      expect(dashboard).toBeDefined();
      expect(dashboard.period.preset).toBe("custom");
      expect(new Date(dashboard.period.start).getFullYear()).toBe(2026);
      expect(new Date(dashboard.period.end).getFullYear()).toBe(2026);
    });

    it("enforces strict organization isolation for Admin queries", async () => {
      const org2Admin = {
        _id: new mongoose.Types.ObjectId(),
        fullName: "Org2 Admin",
        email: "admin@org2.com",
        role: "ADMIN",
        organizationId: org2Id,
      };

      const dashboard = await dashboardService.getDashboard(org2Admin, { period: "this_month" });

      expect(dashboard).toBeDefined();
      expect(dashboard.scope.organizationId).toBe(String(org2Id));
      // Org2 only has org2Employee, no tasks
      expect(dashboard.taskOperations.total).toBe(0);
      expect(dashboard.leaveOperations.pendingCount).toBe(0);
    });

    it("evaluates multiple date range presets deterministically", async () => {
      const presets = ["today", "yesterday", "this_week", "quarter", "year"];
      for (const preset of presets) {
        const dashboard = await dashboardService.getDashboard(adminUser, { period: preset });
        expect(dashboard).toBeDefined();
        expect(dashboard.period.preset).toBe(preset);
        expect(dashboard.period.start).toBeDefined();
        expect(dashboard.period.end).toBeDefined();
      }
    });
  });
});
