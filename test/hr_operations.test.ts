import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import Attendance from "../src/models/Attendance";
import Leave from "../src/models/Leave";
import LeaveType from "../src/models/LeaveType";
import Compensation from "../src/models/Compensation";
import EmployeeDocument from "../src/models/EmployeeDocument";
import { PerformanceSnapshot } from "../src/models/PerformanceSnapshot";
import * as hrService from "../src/services/hrService";

let mongod: MongoMemoryServer;

describe("HR Operations Service & API Tests", () => {
  let orgAId: string;
  let orgBId: string;
  let deptAId: string;
  let teamAId: string;

  let hrAdminUser: any;
  let regularEmployeeUser: any;
  let managerUser: any;
  let orgBUser: any;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);

    // Create Org A and Org B
    const orgA = await Organization.create({ name: "Acme Corp", slug: "acme-corp" });
    orgAId = String(orgA._id);

    const orgB = await Organization.create({ name: "Beta Corp", slug: "beta-corp" });
    orgBId = String(orgB._id);

    // Create Department and Team in Org A
    const dept = await Department.create({ name: "Engineering", code: "ENG", organizationId: orgAId });
    deptAId = String(dept._id);

    const team = await Team.create({ name: "Core Dev", code: "CORE", organizationId: orgAId, departmentId: deptAId });
    teamAId = String(team._id);

    // Create HR Admin user in Org A
    hrAdminUser = await User.create({
      fullName: "Jane HR Admin",
      email: "hr.admin@acme.com",
      passwordHash: "dummyHash123",
      role: "HR",
      organizationId: orgAId,
      departmentId: deptAId,
      designation: "HR Manager",
      status: "ACTIVE",
    });

    // Create Manager user in Org A
    managerUser = await User.create({
      fullName: "Bob Manager",
      email: "bob.manager@acme.com",
      passwordHash: "dummyHash123",
      role: "MANAGER",
      organizationId: orgAId,
      departmentId: deptAId,
      designation: "Engineering Lead",
      status: "ACTIVE",
    });

    // Create Regular Employee in Org A
    regularEmployeeUser = await User.create({
      fullName: "Alice Developer",
      email: "alice@acme.com",
      employeeId: "EMP-0010",
      passwordHash: "dummyHash123",
      role: "EMPLOYEE",
      organizationId: orgAId,
      departmentId: deptAId,
      teamId: teamAId,
      reportingManagerId: managerUser._id,
      designation: "Senior Software Engineer",
      status: "ACTIVE",
      employmentStatus: "ACTIVE",
      joiningDate: new Date("2024-01-15"),
    });

    // Create User in Org B
    orgBUser = await User.create({
      fullName: "Charlie Beta",
      email: "charlie@beta.com",
      passwordHash: "dummyHash123",
      role: "EMPLOYEE",
      organizationId: orgBId,
      designation: "Sales Rep",
      status: "ACTIVE",
    });

    // Seed mock data for Alice (Attendance, Leave, Document, Compensation, Performance)
    await Attendance.create({
      userId: regularEmployeeUser._id,
      organizationId: orgAId,
      date: new Date(),
      attendanceStatus: "PRESENT",
      currentStatus: "ONLINE",
      totalWorkDuration: 480,
    });

    const leaveType = await LeaveType.create({
      organizationId: orgAId,
      name: "Paid Leave",
      code: "PL",
      allocatedDays: 20,
      isPaid: true,
      status: "ACTIVE",
    });

    await Leave.create({
      userId: regularEmployeeUser._id,
      organizationId: orgAId,
      leaveTypeId: leaveType._id,
      leaveType: "PL",
      leaveTypeName: "Paid Leave",
      startDate: new Date("2026-05-01"),
      endDate: new Date("2026-05-03"),
      totalDays: 3,
      reason: "Vacation",
      status: "APPROVED",
    });

    await Compensation.create({
      userId: regularEmployeeUser._id,
      organizationId: orgAId,
      employmentType: "EMPLOYEE",
      compensationType: "SALARY",
      baseAmount: 120000,
      currency: "INR",
      payFrequency: "MONTHLY",
      effectiveFrom: new Date("2024-01-15"),
      status: "ACTIVE",
      createdBy: hrAdminUser._id,
    });

    await EmployeeDocument.create({
      userId: regularEmployeeUser._id,
      organizationId: orgAId,
      documentType: "ID_PROOF",
      title: "Government Passport",
      fileName: "passport.pdf",
      fileUrl: "https://example.com/passport.pdf",
      uploadedBy: regularEmployeeUser._id,
      status: "VERIFIED",
    });

    await PerformanceSnapshot.create({
      userId: regularEmployeeUser._id,
      organizationId: orgAId,
      performanceScore: 92,
      taskCompletionScore: 95,
      timelinessScore: 90,
      attendanceScore: 90,
      targetScore: 90,
      consistencyScore: 92,
      productivityScore: 93,
      periodType: "DAILY",
      calculatedAt: new Date(),
      periodStart: new Date(),
      periodEnd: new Date(),
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  describe("Phase 1 & 2: HR Overview & Directory Listing", () => {
    it("should return correct organization HR metrics overview", async () => {
      const overview = await hrService.getHrOverview(hrAdminUser);
      expect(overview.totalEmployees).toBeGreaterThanOrEqual(3);
      expect(overview.activeEmployees).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(overview.departments)).toBe(true);
      expect(overview.departments.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter employees by designation, department, and search query", async () => {
      const result = await hrService.listEmployees(hrAdminUser, {
        search: "Alice",
        departmentId: deptAId,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].fullName).toBe("Alice Developer");
      expect(result.items[0].designation).toBe("Senior Software Engineer");
    });

    it("should mask sensitive fields when a non-privileged peer views employee directory", async () => {
      const result = await hrService.listEmployees(regularEmployeeUser, {
        search: "Bob",
      });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      const bob = result.items[0];
      // Public directory fields present
      expect(bob.fullName).toBe("Bob Manager");
      expect(bob.designation).toBe("Engineering Lead");
      // Sensitive fields omitted
      expect(bob.personalEmail).toBeUndefined();
      expect(bob.currentAddress).toBeUndefined();
      expect(bob.emergencyContactPhone).toBeUndefined();
    });
  });

  describe("Phase 4: Unified Employee HR Profile Aggregation", () => {
    it("should aggregate User, Attendance, Leave, Performance, Documents, and Compensation for HR Admin", async () => {
      const profile = await hrService.getEmployeeHrProfile(hrAdminUser, String(regularEmployeeUser._id));

      expect(profile.user).toBeDefined();
      expect(profile.user.fullName).toBe("Alice Developer");
      expect(profile.attendanceSummary).toBeDefined();
      expect(profile.attendanceSummary.attendanceRate).toBeGreaterThan(0);
      expect(profile.leaveSummary).toBeDefined();
      expect(profile.performanceSummary).toBeDefined();
      expect(profile.performanceSummary?.performanceScore).toBe(92);
      expect(profile.compensation).toBeDefined();
      expect(profile.compensation?.baseAmount).toBe(120000);
      expect(profile.documents).toBeDefined();
      expect(profile.documents.length).toBeGreaterThanOrEqual(1);
      expect(profile.onboarding).toBeDefined();
      expect(profile.offboarding).toBeDefined();
    });

    it("should prevent cross-organization employee profile access", async () => {
      await expect(
        hrService.getEmployeeHrProfile(hrAdminUser, String(orgBUser._id))
      ).rejects.toThrow("FORBIDDEN_ORGANIZATION_ACCESS");
    });
  });

  describe("Phase 5: Employee Lifecycle State Transitions", () => {
    it("should allow valid transition from ACTIVE to NOTICE_PERIOD and record exit details", async () => {
      const updated = await hrService.updateEmployeeLifecycle(hrAdminUser, String(regularEmployeeUser._id), {
        status: "NOTICE_PERIOD",
        exitReason: "Career Growth",
        exitNoticeDate: new Date(),
        exitDate: new Date("2026-06-30"),
      });

      expect(updated.status).toBe("NOTICE_PERIOD");
      expect(updated.employmentStatus).toBe("NOTICE_PERIOD");
      expect(updated.exitReason).toBe("Career Growth");
    });

    it("should reject invalid state transitions", async () => {
      // Cannot jump from NOTICE_PERIOD directly to PROBATION
      await expect(
        hrService.updateEmployeeLifecycle(hrAdminUser, String(regularEmployeeUser._id), {
          status: "PROBATION",
        })
      ).rejects.toThrow("INVALID_LIFECYCLE_TRANSITION");
    });

    it("should allow transitioning from NOTICE_PERIOD to EXITED", async () => {
      const updated = await hrService.updateEmployeeLifecycle(hrAdminUser, String(regularEmployeeUser._id), {
        status: "EXITED",
        exitDate: new Date("2026-06-30"),
      });

      expect(updated.status).toBe("EXITED");
    });
  });

  describe("Phase 6: Onboarding Checklist Management", () => {
    let newEmployee: any;

    beforeAll(async () => {
      newEmployee = await User.create({
        fullName: "Dave Onboarding",
        email: "dave@acme.com",
        passwordHash: "dummyHash123",
        role: "EMPLOYEE",
        organizationId: orgAId,
        status: "PROBATION",
        onboardingStatus: "PENDING",
      });
    });

    it("should update an onboarding checklist task and transition status to IN_PROGRESS", async () => {
      const res = await hrService.updateOnboardingChecklist(
        hrAdminUser,
        String(newEmployee._id),
        "DOCUMENT_SUBMISSION",
        true
      );

      expect(res.onboardingStatus).toBe("IN_PROGRESS");
      const docTask = res.checklist?.find((c) => c.key === "DOCUMENT_SUBMISSION");
      expect(docTask?.completed).toBe(true);
      expect(docTask?.completedBy).toBe("Jane HR Admin");
    });

    it("should reject non-HR users from updating onboarding checklist", async () => {
      await expect(
        hrService.updateOnboardingChecklist(
          regularEmployeeUser,
          String(newEmployee._id),
          "PROFILE_COMPLETION",
          true
        )
      ).rejects.toThrow("FORBIDDEN_HR_ACTION");
    });
  });

  describe("Phase 7: Offboarding Clearance Tracking", () => {
    it("should update multi-department clearances (IT, Finance, Admin, HR)", async () => {
      const clearance = await hrService.updateOffboardingClearance(
        hrAdminUser,
        String(regularEmployeeUser._id),
        "it",
        true
      );

      expect(clearance.it).toBe(true);
      expect(clearance.finance).toBe(false);

      const financeClearance = await hrService.updateOffboardingClearance(
        hrAdminUser,
        String(regularEmployeeUser._id),
        "finance",
        true
      );
      expect(financeClearance.finance).toBe(true);
    });
  });

  describe("Phase 8: Reporting Hierarchy & Manager Validation", () => {
    it("should reject setting employee as their own reporting manager", async () => {
      await expect(
        hrService.validateManagerAssignment(
          String(regularEmployeeUser._id),
          String(regularEmployeeUser._id),
          orgAId
        )
      ).rejects.toThrow("CANNOT_MANAGE_SELF");
    });

    it("should reject manager assignment from a different organization", async () => {
      await expect(
        hrService.validateManagerAssignment(
          String(regularEmployeeUser._id),
          String(orgBUser._id),
          orgAId
        )
      ).rejects.toThrow("MANAGER_CROSS_ORG_FORBIDDEN");
    });

    it("should reject circular reporting structures", async () => {
      // Bob manages Alice. Alice cannot manage Bob.
      await expect(
        hrService.validateManagerAssignment(
          String(managerUser._id),
          String(regularEmployeeUser._id),
          orgAId
        )
      ).rejects.toThrow("CIRCULAR_REPORTING_DETECTED");
    });
  });

  describe("Phase 13: Confidential HR Notes", () => {
    let createdNoteId: string;

    it("should allow HR Admin to add a confidential note to an employee profile", async () => {
      const note = await hrService.addHrNote(
        hrAdminUser,
        String(regularEmployeeUser._id),
        "Probation review concluded with outstanding performance."
      );

      expect(note.id).toBeDefined();
      expect(note.note).toBe("Probation review concluded with outstanding performance.");
      expect(note.authorName).toBe("Jane HR Admin");
      createdNoteId = note.id;
    });

    it("should prevent regular employees from adding or viewing confidential HR notes", async () => {
      await expect(
        hrService.addHrNote(
          regularEmployeeUser,
          String(managerUser._id),
          "Trying to write private note"
        )
      ).rejects.toThrow("FORBIDDEN_HR_ACTION");

      // Verify regular employee does not receive HR notes in profile
      const profile = await hrService.getEmployeeHrProfile(regularEmployeeUser, String(regularEmployeeUser._id));
      expect(profile.user.hrNotes).toBeUndefined();
    });

    it("should allow HR Admin to delete an HR note", async () => {
      const res = await hrService.deleteHrNote(
        hrAdminUser,
        String(regularEmployeeUser._id),
        createdNoteId
      );
      expect(res.success).toBe(true);

      const userAfter = await User.findById(regularEmployeeUser._id).lean();
      const hasNote = userAfter?.hrNotes?.some((n) => n.id === createdNoteId);
      expect(hasNote).toBe(false);
    });
  });
});
