import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import DailyReport, { normalizeBlockers } from "../src/models/DailyReport";
import Task from "../src/models/Task";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import { PointTransaction } from "../src/models/PointTransaction";
import { PerformanceSnapshot } from "../src/models/PerformanceSnapshot";
import * as eodReportService from "../src/services/eodReportService";
import { PointService } from "../src/services/pointService";
import { PerformanceScoreService } from "../src/services/performanceScoreService";

describe("EOD / Daily Work Report End-to-End Integration Tests", () => {
  let mongoServer: MongoMemoryServer;
  let testOrgId: mongoose.Types.ObjectId;
  let testDeptId: mongoose.Types.ObjectId;
  let employeeId: mongoose.Types.ObjectId;
  let managerId: mongoose.Types.ObjectId;
  let teamLeadId: mongoose.Types.ObjectId;
  let otherOrgEmployeeId: mongoose.Types.ObjectId;
  let testTeamId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Create Org
    const org = await Organization.create({
      name: "EOD Test Corp",
      slug: "eod-test-corp",
      status: "ACTIVE",
    });
    testOrgId = org._id as mongoose.Types.ObjectId;

    // Create Department
    const dept = await Department.create({
      name: "Engineering",
      code: "ENG-DEPT",
      organizationId: testOrgId,
      status: "ACTIVE",
    });
    testDeptId = dept._id as mongoose.Types.ObjectId;

    // Create Manager
    const manager = await User.create({
      email: "manager@eodtest.com",
      passwordHash: "hashedPassword123",
      fullName: "Test Manager",
      role: "MANAGER",
      organizationId: testOrgId,
      departmentId: testDeptId,
      status: "ACTIVE",
    });
    managerId = manager._id as mongoose.Types.ObjectId;

    // Create Team Lead
    const teamLead = await User.create({
      email: "lead@eodtest.com",
      passwordHash: "hashedPassword123",
      fullName: "Test Team Lead",
      role: "TEAM_LEADER",
      organizationId: testOrgId,
      departmentId: testDeptId,
      status: "ACTIVE",
    });
    teamLeadId = teamLead._id as mongoose.Types.ObjectId;

    // Create Team
    const team = await Team.create({
      name: "Engineering Team",
      code: "ENG",
      organizationId: testOrgId,
      departmentId: testDeptId,
      managerId,
      teamLeadId,
      members: [],
    });
    testTeamId = team._id as mongoose.Types.ObjectId;

    // Create Employee
    const emp = await User.create({
      email: "developer@eodtest.com",
      passwordHash: "hashedPassword123",
      fullName: "Test Developer",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: testDeptId,
      teamId: testTeamId,
      reportingManagerId: managerId,
      status: "ACTIVE",
    });
    employeeId = emp._id as mongoose.Types.ObjectId;

    // Create another employee in a different organization
    const otherOrg = await Organization.create({
      name: "Other Org",
      slug: "other-org",
      status: "ACTIVE",
    });
    const otherEmp = await User.create({
      email: "other@otherorg.com",
      passwordHash: "hashedPassword123",
      fullName: "Other Employee",
      role: "EMPLOYEE",
      organizationId: otherOrg._id,
      status: "ACTIVE",
    });
    otherOrgEmployeeId = otherEmp._id as mongoose.Types.ObjectId;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await DailyReport.deleteMany({});
    await Task.deleteMany({});
    await PointTransaction.deleteMany({});
    await PerformanceSnapshot.deleteMany({});
  });

  describe("Blocker Normalization", () => {
    it("normalizes legacy string blockers into structured IEODBlocker objects", () => {
      const raw = ["API returned 500 error", "Waiting on Figma specs"];
      const normalized = normalizeBlockers(raw);

      expect(normalized).toHaveLength(2);
      expect(normalized[0].title).toBe("API returned 500 error");
      expect(normalized[0].severity).toBe("MEDIUM");
      expect(normalized[0].resolved).toBe(false);
      expect(normalized[0].blockerId).toMatch(/^BLK-/);

      expect(normalized[1].title).toBe("Waiting on Figma specs");
    });

    it("normalizes structured blocker objects and preserves severity & attributes", () => {
      const raw = [
        {
          title: "Production database latency",
          severity: "CRITICAL",
          category: "INFRASTRUCTURE",
          resolved: true,
        },
      ];
      const normalized = normalizeBlockers(raw);

      expect(normalized).toHaveLength(1);
      expect(normalized[0].title).toBe("Production database latency");
      expect(normalized[0].severity).toBe("CRITICAL");
      expect(normalized[0].category).toBe("INFRASTRUCTURE");
      expect(normalized[0].resolved).toBe(true);
      expect(normalized[0].resolvedAt).toBeInstanceOf(Date);
    });

    it("handles mixed arrays, nulls, and empty inputs gracefully", () => {
      expect(normalizeBlockers(null)).toEqual([]);
      expect(normalizeBlockers(undefined)).toEqual([]);
      expect(normalizeBlockers([])).toEqual([]);

      const mixed = ["String Blocker", null, { title: "Object Blocker", severity: "HIGH" }];
      const normalized = normalizeBlockers(mixed);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].title).toBe("String Blocker");
      expect(normalized[1].title).toBe("Object Blocker");
      expect(normalized[1].severity).toBe("HIGH");
    });
  });

  describe("EOD Draft Creation & Authoritative Task Snapshot", () => {
    it("creates an EOD draft with numeric completedTasks and authoritative metrics", async () => {
      // Create completed & in-progress tasks for employee
      await Task.create({
        taskId: "TSK-EOD-01",
        title: "Build API Gateway",
        assignedTo: employeeId,
        assignedBy: managerId,
        organizationId: testOrgId,
        status: "COMPLETED",
        estimatedMinutes: 120,
        actualMinutes: 110,
      });
      await Task.create({
        taskId: "TSK-EOD-02",
        title: "Write unit tests",
        assignedTo: employeeId,
        assignedBy: managerId,
        organizationId: testOrgId,
        status: "IN_PROGRESS",
        estimatedMinutes: 60,
      });

      const report = await eodReportService.createOrUpdateEODReport(String(employeeId), {
        summary: "Worked on API gateway and unit tests",
        blockers: ["Waiting for design signoff"],
        status: "DRAFT",
        action: "DRAFT",
      });

      expect(report).toBeDefined();
      expect(report.status).toBe("DRAFT");
      expect(typeof report.completedTasks).toBe("number");
      expect(report.completedTasks).toBe(1);
      expect(report.tasksCompleted).toBe(1);
      expect(report.totalTasksWorked).toBe(2);
      expect(report.blockerCount).toBe(1);
      expect(report.blockers[0].title).toBe("Waiting for design signoff");
      expect(report.completedSummary).toBe("Worked on API gateway and unit tests");

      // Points should NOT be awarded on draft creation
      const points = await PointTransaction.find({ userId: employeeId });
      expect(points).toHaveLength(0);
    });
  });

  describe("EOD Submission & Points Idempotency", () => {
    it("submits EOD report, awards DAILY_REPORT_SUBMITTED points exactly once, and updates performance snapshot", async () => {
      await Task.create({
        taskId: "TSK-EOD-03",
        title: "Feature A",
        assignedTo: employeeId,
        assignedBy: managerId,
        organizationId: testOrgId,
        status: "COMPLETED",
      });

      // 1. Submit report
      const submittedReport = await eodReportService.createOrUpdateEODReport(String(employeeId), {
        summary: "Completed Feature A successfully",
        action: "SUBMIT",
      });

      expect(submittedReport.status).toBe("SUBMITTED");
      expect(submittedReport.submittedAt).toBeDefined();

      // 2. Verify points awarded
      const pointTxns = await PointTransaction.find({
        userId: employeeId,
        type: "EARNED",
      });
      expect(pointTxns).toHaveLength(1);
      expect(pointTxns[0].points).toBe(2);
      expect(pointTxns[0].reason).toContain("DAILY_REPORT_SUBMITTED");

      // 3. Verify performance snapshot generated
      const snapshot = await PerformanceSnapshot.findOne({
        userId: employeeId,
        organizationId: testOrgId,
      });
      expect(snapshot).toBeDefined();
      expect(snapshot?.performanceScore).toBeGreaterThan(0);

      // 4. Idempotency test: resubmitting or saving again should NOT duplicate point awards
      const resubmitted = await eodReportService.createOrUpdateEODReport(String(employeeId), {
        summary: "Updated summary for Feature A",
        action: "SUBMIT",
      });
      expect(resubmitted).toBeDefined();

      const pointTxnsAfter = await PointTransaction.find({
        userId: employeeId,
        type: "EARNED",
      });
      expect(pointTxnsAfter).toHaveLength(1); // Still exactly 1 transaction
    });
  });

  describe("EOD Review & RBAC Management Scoping", () => {
    it("allows manager to approve employee EOD report and updates performance snapshot", async () => {
      const reportDoc = await eodReportService.createOrUpdateEODReport(String(employeeId), {
        summary: "Ready for review",
        action: "SUBMIT",
      });

      const managerUser = {
        _id: managerId,
        role: "MANAGER",
        organizationId: testOrgId,
        fullName: "Test Manager",
      };

      const approved = await eodReportService.approveEODReport(
        String(reportDoc._id),
        managerUser,
        "Great work today!"
      );

      expect(approved.status).toBe("APPROVED");
      expect(String(approved.reviewedBy)).toBe(String(managerId));
      expect(approved.reviewerRemarks).toBe("Great work today!");
      expect(approved.reviewedAt).toBeDefined();
    });

    it("prevents self-review by employee", async () => {
      const reportDoc = await eodReportService.createOrUpdateEODReport(String(employeeId), {
        summary: "My report",
        action: "SUBMIT",
      });

      const employeeUser = {
        _id: employeeId,
        role: "EMPLOYEE",
        organizationId: testOrgId,
      };

      await expect(
        eodReportService.approveEODReport(String(reportDoc._id), employeeUser)
      ).rejects.toThrow("CANNOT_REVIEW_OWN_REPORT");
    });

    it("returns EOD report for rework with mandatory reworkReason", async () => {
      const reportDoc = await eodReportService.createOrUpdateEODReport(String(employeeId), {
        summary: "Needs more details",
        action: "SUBMIT",
      });

      const managerUser = {
        _id: managerId,
        role: "MANAGER",
        organizationId: testOrgId,
        fullName: "Test Manager",
      };

      // Empty rework reason should fail
      await expect(
        eodReportService.returnEODReport(String(reportDoc._id), managerUser, "")
      ).rejects.toThrow("REWORK_REASON_REQUIRED");

      const returned = await eodReportService.returnEODReport(
        String(reportDoc._id),
        managerUser,
        "Please provide detailed summary of bug fixes."
      );

      expect(returned.status).toBe("RETURNED");
      expect(returned.reworkReason).toBe("Please provide detailed summary of bug fixes.");
    });

    it("enforces cross-organization isolation (FORBIDDEN)", async () => {
      const reportDoc = await eodReportService.createOrUpdateEODReport(String(employeeId), {
        summary: "Secret internal report",
        action: "SUBMIT",
      });

      const otherUser = {
        _id: otherOrgEmployeeId,
        role: "ADMIN",
        organizationId: new mongoose.Types.ObjectId(),
      };

      await expect(
        eodReportService.getEODReportById(String(reportDoc._id), otherUser)
      ).rejects.toThrow("FORBIDDEN");
    });
  });
});
