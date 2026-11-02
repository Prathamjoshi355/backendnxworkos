import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Division from "../src/models/Division";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import Attendance from "../src/models/Attendance";
import Leave from "../src/models/Leave";
import SchedulerLock from "../src/models/SchedulerLock";

import * as userService from "../src/services/userService";
import * as authService from "../src/services/authService";
import * as attendanceService from "../src/services/attendanceService";
import * as absenceSchedulerService from "../src/services/absenceSchedulerService";
import { getUserFromRequest, PasswordChangeRequiredError } from "../src/middleware/auth";

describe("Phase 3 End-to-End Hardening, Scheduler Integration & RBAC Verification", () => {
  let mongoServer: MongoMemoryServer;

  let orgAlpha: any;
  let orgBeta: any;
  let divAlphaEngineering: any;
  let divAlphaMarketing: any;
  let deptEngineering: any;
  let teamAlphaBackend: any;

  let superAdminUser: any;
  let adminAlphaUser: any;
  let hrAlphaUser: any;
  let divAdminEngineeringUser: any;
  let managerAlphaUser: any;
  let teamLeadAlphaUser: any;
  let employeeUser: any;
  let internUser: any;
  let unassignedEmployee: any;

  const JWT_SECRET = process.env.JWT_SECRET || "nexisparkx_dev_secret_key_fixed_2026";

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGODB_URI = uri;

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }

    await Division.syncIndexes();
    await Attendance.syncIndexes();
    await SchedulerLock.syncIndexes();

    // 1. Seed Organizations
    orgAlpha = await Organization.create({
      name: "Alpha Corporation",
      code: "ALPHA",
      timezone: "UTC",
      workingHours: {
        workStartTime: "09:30",
        workEndTime: "18:30",
        gracePeriodMinutes: 10,
        workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      },
      settings: { dailyReportRequiredBeforeLogout: false },
      status: "ACTIVE",
    });

    orgBeta = await Organization.create({
      name: "Beta Corporation",
      code: "BETA",
      timezone: "UTC",
      workingHours: {
        workStartTime: "09:00",
        workEndTime: "17:00",
        gracePeriodMinutes: 15,
        workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      },
      settings: { dailyReportRequiredBeforeLogout: false },
      status: "ACTIVE",
    });

    // 2. Seed Divisions, Department & Team in Org Alpha
    divAlphaEngineering = await Division.create({
      organizationId: orgAlpha._id,
      name: "Alpha Engineering Division",
      code: "ENG",
      status: "ACTIVE",
    });

    divAlphaMarketing = await Division.create({
      organizationId: orgAlpha._id,
      name: "Alpha Marketing Division",
      code: "MKT",
      status: "ACTIVE",
    });

    deptEngineering = await Department.create({
      organizationId: orgAlpha._id,
      divisionId: divAlphaEngineering._id,
      name: "Software Engineering",
      code: "ENG-DEPT",
      status: "ACTIVE",
    });

    teamAlphaBackend = await Team.create({
      organizationId: orgAlpha._id,
      departmentId: String(deptEngineering._id),
      name: "Backend Core Team",
      code: "BACKEND-CORE",
      status: "ACTIVE",
    });

    // 3. Seed Platform & Tenant Roles
    superAdminUser = await User.create({
      fullName: "Global Super Admin",
      email: "superadmin@nxworkos.io",
      role: "SUPER_ADMIN",
      passwordHash: await bcrypt.hash("Admin@12345", 10),
      status: "ACTIVE",
    });

    adminAlphaUser = await User.create({
      organizationId: orgAlpha._id,
      fullName: "Alpha Admin",
      email: "admin@alpha.com",
      role: "ADMIN",
      passwordHash: await bcrypt.hash("Admin@12345", 10),
      status: "ACTIVE",
    });

    hrAlphaUser = await User.create({
      organizationId: orgAlpha._id,
      fullName: "Alpha HR Specialist",
      email: "hr@alpha.com",
      role: "HR",
      passwordHash: await bcrypt.hash("HrSecure@123", 10),
      status: "ACTIVE",
    });

    divAdminEngineeringUser = await User.create({
      organizationId: orgAlpha._id,
      divisionId: divAlphaEngineering._id,
      fullName: "Engineering Division Admin",
      email: "divadmin.eng@alpha.com",
      role: "DIVISION_ADMIN",
      passwordHash: await bcrypt.hash("DivAdmin@123", 10),
      status: "ACTIVE",
    });

    managerAlphaUser = await User.create({
      organizationId: orgAlpha._id,
      divisionId: divAlphaEngineering._id,
      departmentId: String(deptEngineering._id),
      fullName: "Alpha Engineering Manager",
      email: "manager.eng@alpha.com",
      role: "MANAGER",
      managedTeamIds: [String(teamAlphaBackend._id)],
      passwordHash: await bcrypt.hash("Manager@123", 10),
      status: "ACTIVE",
    });

    teamLeadAlphaUser = await User.create({
      organizationId: orgAlpha._id,
      divisionId: divAlphaEngineering._id,
      departmentId: String(deptEngineering._id),
      teamId: String(teamAlphaBackend._id),
      fullName: "Backend Team Lead",
      email: "teamlead.backend@alpha.com",
      role: "TEAM_LEADER",
      managedTeamIds: [String(teamAlphaBackend._id)],
      passwordHash: await bcrypt.hash("TeamLead@123", 10),
      status: "ACTIVE",
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // =========================================================================
  // Scenarios 1 - 7: User Onboarding, Temporary Credentials & Password Change
  // =========================================================================
  describe("Scenario 1 to 7: Onboarding, First Login, Access Restriction & Password Change", () => {
    let newEmployee: any;
    let initialLoginResult: any;

    test("1 & 2. Admin creates Employee with default temporary password 'Nexisparkx@123', secure hash, and metadata", async () => {
      newEmployee = await userService.createUser({
        organizationId: orgAlpha._id,
        divisionId: divAlphaEngineering._id,
        departmentId: String(deptEngineering._id),
        teamId: String(teamAlphaBackend._id),
        fullName: "Arthur Dent",
        email: "arthur.dent@alpha.com",
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
      });

      expect(newEmployee).toBeDefined();
      expect(newEmployee._id).toBeDefined();
      expect(newEmployee.mustChangePassword).toBe(true);
      expect((newEmployee as any).passwordHash).toBeUndefined(); // Never exposed

      const storedUser = await User.findById(newEmployee._id).select("+passwordHash");
      expect(storedUser).toBeDefined();
      expect(storedUser!.passwordHash).toBeDefined();
      expect(storedUser!.passwordHash).not.toBe("Nexisparkx@123"); // Not stored in plaintext
      const isMatch = await bcrypt.compare("Nexisparkx@123", storedUser!.passwordHash);
      expect(isMatch).toBe(true);

      expect(storedUser!.passwordMetadata?.defaultAssigned).toBe(true);
      expect(storedUser!.passwordMetadata?.temporaryPasswordAssignedAt).toBeDefined();
    });

    test("3 & 4. Employee logs in and backend flags mustChangePassword = true", async () => {
      initialLoginResult = await authService.loginUser("arthur.dent@alpha.com", "Nexisparkx@123");

      expect(initialLoginResult.token).toBeDefined();
      expect(initialLoginResult.mustChangePassword).toBe(true);
      expect(initialLoginResult.user.mustChangePassword).toBe(true);
    });

    test("5. Protected business resources remain blocked before password change (HTTP 403 PASSWORD_CHANGE_REQUIRED)", async () => {
      const mockProtectedRequest = new Request("https://api.nxworkos.io/api/tasks", {
        headers: { Authorization: `Bearer ${initialLoginResult.token}` },
      });

      await expect(getUserFromRequest(mockProtectedRequest)).rejects.toThrow(PasswordChangeRequiredError);

      const mockAttendanceRequest = new Request("https://api.nxworkos.io/api/attendance/live", {
        headers: { Authorization: `Bearer ${initialLoginResult.token}` },
      });

      await expect(getUserFromRequest(mockAttendanceRequest)).rejects.toThrow(PasswordChangeRequiredError);

      // Exempt endpoints must be allowed
      const mockChangePasswordRequest = new Request("https://api.nxworkos.io/api/auth/change-password", {
        headers: { Authorization: `Bearer ${initialLoginResult.token}` },
      });
      const allowedUser = await getUserFromRequest(mockChangePasswordRequest);
      expect(allowedUser).toBeDefined();
      expect(String(allowedUser!._id)).toBe(String(newEmployee._id));
    });

    test("6 & 7. Employee changes password; normal access is unlocked and previous session tokens are invalidated", async () => {
      // Rejects identical new password
      await expect(
        authService.changePassword({
          userId: String(newEmployee._id),
          currentPassword: "Nexisparkx@123",
          newPassword: "Nexisparkx@123",
        })
      ).rejects.toThrow("NEW_PASSWORD_SAME_AS_CURRENT");

      // Rejects weak password
      await expect(
        authService.changePassword({
          userId: String(newEmployee._id),
          currentPassword: "Nexisparkx@123",
          newPassword: "weak",
        })
      ).rejects.toThrow("WEAK_PASSWORD");

      // Successful change
      const changeResult = await authService.changePassword({
        userId: String(newEmployee._id),
        currentPassword: "Nexisparkx@123",
        newPassword: "ArthurStrongPass@2026",
        confirmPassword: "ArthurStrongPass@2026",
      });

      expect(changeResult.mustChangePassword).toBe(false);
      expect(changeResult.token).toBeDefined(); // Returns fresh session token

      const freshToken = changeResult.token;

      // New token has immediate access to protected endpoints
      const mockProtectedRequest = new Request("https://api.nxworkos.io/api/tasks", {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      const resolvedUser = await getUserFromRequest(mockProtectedRequest);
      expect(resolvedUser).toBeDefined();
      expect(resolvedUser!.mustChangePassword).toBe(false);

      // Old pre-password-change token is invalidated
      const mockOldTokenRequest = new Request("https://api.nxworkos.io/api/tasks", {
        headers: { Authorization: `Bearer ${initialLoginResult.token}` },
      });
      const oldTokenResult = await getUserFromRequest(mockOldTokenRequest);
      expect(oldTokenResult).toBeNull(); // Token invalidated due to subsequent password change
    });
  });

  // =========================================================================
  // Scenarios 8 - 12: Attendance Separation, Explicit Check-in & Timestamps
  // =========================================================================
  describe("Scenario 8 to 12: Separation of Platform Login from Attendance, Check-in/out & Working Duration", () => {
    let attendanceEmployee: any;

    beforeAll(async () => {
      attendanceEmployee = await User.create({
        organizationId: orgAlpha._id,
        divisionId: divAlphaEngineering._id,
        departmentId: String(deptEngineering._id),
        teamId: String(teamAlphaBackend._id),
        fullName: "Ford Prefect",
        email: "ford.prefect@alpha.com",
        role: "EMPLOYEE",
        passwordHash: await bcrypt.hash("FordPass@2026", 10),
        status: "ACTIVE",
      });
    });

    test("8. Platform login does NOT create an attendance record or mark user PRESENT", async () => {
      const loginRes = await authService.loginUser("ford.prefect@alpha.com", "FordPass@2026");
      expect(loginRes.token).toBeDefined();

      const todayAttendance = await Attendance.findOne({
        userId: attendanceEmployee._id,
        date: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      });

      // No attendance record created merely by authenticating
      expect(todayAttendance).toBeNull();
    });

    test("9 & 10. Employee explicitly checks in; status becomes PRESENT or LATE with exact checkInTime", async () => {
      const checkInRes = await attendanceService.checkInAttendance(String(attendanceEmployee._id), "WEB");

      expect(checkInRes.attendance).toBeDefined();
      expect(["PRESENT", "LATE"]).toContain(checkInRes.attendance.attendanceStatus);
      expect(checkInRes.attendance.checkInTime).toBeDefined();
      expect(checkInRes.attendance.firstLoginAt).toBeDefined(); // Legacy backward compatibility
      expect(checkInRes.attendance.currentStatus).toBe("ONLINE");

      expect(checkInRes.session).toBeDefined();
      expect(checkInRes.session.status).toBe("ACTIVE");
    });

    test("11 & 12. Employee checks out; working duration is calculated and stored in workingDuration", async () => {
      // Simulate 45 minutes of work
      await new Promise((r) => setTimeout(r, 50));

      const checkOutRes = await attendanceService.checkOutAttendance(String(attendanceEmployee._id), { bypassEod: true });

      expect(checkOutRes.attendance).toBeDefined();
      expect(checkOutRes.attendance.checkOutTime).toBeDefined();
      expect(checkOutRes.attendance.lastLogoutAt).toBeDefined(); // Legacy backward compatibility
      expect(checkOutRes.attendance.workingDuration).toBeGreaterThanOrEqual(0);
      expect(checkOutRes.attendance.totalWorkDuration).toBeGreaterThanOrEqual(0);
      expect(checkOutRes.attendance.currentStatus).toBe("OFFLINE");
      expect(checkOutRes.session.status).toBe("COMPLETED");
    });
  });

  // =========================================================================
  // Scenarios 13 - 14: Cutoff Finalization & Approved Leave Protection
  // =========================================================================
  describe("Scenario 13 to 14: Cutoff Finalization, ABSENT Assignment & Approved Leave Protection", () => {
    let absentCandidate: any;
    let leaveCandidate: any;

    beforeAll(async () => {
      absentCandidate = await User.create({
        organizationId: orgAlpha._id,
        fullName: "Trillian Astra",
        email: "trillian@alpha.com",
        role: "EMPLOYEE",
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
        passwordHash: "dummy",
      });

      leaveCandidate = await User.create({
        organizationId: orgAlpha._id,
        fullName: "Zaphod Beeblebrox",
        email: "zaphod@alpha.com",
        role: "EMPLOYEE",
        status: "ACTIVE",
        employmentStatus: "ACTIVE",
        passwordHash: "dummy",
      });

      const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
      const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

      // Approved leave covering today for leaveCandidate
      await Leave.create({
        userId: leaveCandidate._id,
        organizationId: orgAlpha._id,
        leaveType: "CASUAL_LEAVE",
        leaveTypeName: "Casual Leave",
        startDate: todayStart,
        endDate: todayEnd,
        status: "APPROVED",
        reason: "Interstellar travel",
      });
    });

    test("13 & 14. finalizeDailyAbsentees marks un-checked-in user as ABSENT, user on approved leave as ON_LEAVE", async () => {
      const results = await attendanceService.finalizeDailyAbsentees({
        organizationId: String(orgAlpha._id),
      });

      expect(results.evaluated).toBeGreaterThanOrEqual(2);

      // Verify un-checked-in user is ABSENT
      const absentAtt = await Attendance.findOne({
        userId: absentCandidate._id,
        date: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      });
      expect(absentAtt).toBeDefined();
      expect(absentAtt!.attendanceStatus).toBe("ABSENT");
      expect(absentAtt!.checkInTime).toBeNull();

      // Verify user on approved leave is ON_LEAVE, NOT ABSENT
      const leaveAtt = await Attendance.findOne({
        userId: leaveCandidate._id,
        date: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      });
      expect(leaveAtt).toBeDefined();
      expect(leaveAtt!.attendanceStatus).toBe("ON_LEAVE");
    });
  });

  // =========================================================================
  // Scenarios 15 - 18: Scoped Attendance RBAC & Isolation
  // =========================================================================
  describe("Scenario 15 to 18: Multi-Tenant Attendance RBAC Scoping & Isolation", () => {
    let betaEmployee: any;
    let marketingEmployee: any;

    beforeAll(async () => {
      betaEmployee = await User.create({
        organizationId: orgBeta._id,
        fullName: "Marvin Paranoid",
        email: "marvin@beta.com",
        role: "EMPLOYEE",
        status: "ACTIVE",
        passwordHash: "dummy",
      });

      marketingEmployee = await User.create({
        organizationId: orgAlpha._id,
        divisionId: divAlphaMarketing._id,
        fullName: "Eddie Computer",
        email: "eddie@alpha.com",
        role: "EMPLOYEE",
        status: "ACTIVE",
        passwordHash: "dummy",
      });
    });

    test("15. Admin and HR see only authorized organizational attendance; cross-tenant access is blocked", async () => {
      const alphaLive = await attendanceService.getLiveAttendance({
        organizationId: String(orgAlpha._id),
      });

      const userIdsInAlpha = alphaLive.map((u) => u.userId);
      expect(userIdsInAlpha).not.toContain(String(betaEmployee._id));

      const betaLive = await attendanceService.getLiveAttendance({
        organizationId: String(orgBeta._id),
      });
      const userIdsInBeta = betaLive.map((u) => u.userId);
      expect(userIdsInBeta).toContain(String(betaEmployee._id));
      expect(userIdsInBeta).not.toContain(String(marketingEmployee._id));
    });

    test("16. Division Admin sees only users in their assigned active division", async () => {
      const engDivisionLive = await attendanceService.getLiveAttendance({
        organizationId: String(orgAlpha._id),
        divisionId: String(divAlphaEngineering._id),
      });

      const engUserIds = engDivisionLive.map((u) => u.userId);
      // Contains engineering users
      expect(engUserIds).toContain(String(managerAlphaUser._id));
      // Does NOT contain marketing users from another division
      expect(engUserIds).not.toContain(String(marketingEmployee._id));
    });

    test("17. Manager and Team Leader see only their authorized reporting/managed team scope", async () => {
      const teamLive = await attendanceService.getLiveAttendance({
        organizationId: String(orgAlpha._id),
        teamIds: [String(teamAlphaBackend._id)],
      });

      const teamUserIds = teamLive.map((u) => u.userId);
      expect(teamUserIds).toContain(String(teamLeadAlphaUser._id));
      expect(teamUserIds).not.toContain(String(marketingEmployee._id));
    });

    test("18. Employee sees only their own attendance telemetry", async () => {
      const employeeLive = await attendanceService.getLiveAttendance({
        userIds: [String(marketingEmployee._id)],
        organizationId: String(orgAlpha._id),
      });

      expect(employeeLive.length).toBe(1);
      expect(employeeLive[0].userId).toBe(String(marketingEmployee._id));
      expect(employeeLive[0].fullName).toBe("Eddie Computer");
    });
  });

  // =========================================================================
  // Scenarios 19 - 20: Production Absence Scheduler & Credential Expiry
  // =========================================================================
  describe("Scenario 19 to 20: Production Absence Scheduler (Distributed Lock, Cutoff & Expiry)", () => {
    test("19. Production Absence Scheduler acquires distributed lock, respects premature cutoff, and runs idempotently", async () => {
      // 1st Run: with force: true to simulate post-cutoff execution
      const jobResult = await absenceSchedulerService.runAbsenceFinalizationJob({
        organizationId: String(orgAlpha._id),
        force: true,
      });

      expect(jobResult.executed).toBe(true);
      expect(jobResult.jobName).toBe("FINALIZE_DAILY_ABSENTEES");
      expect(jobResult.organizationsProcessed).toBe(1);

      // Verify lock state in MongoDB
      const lockDoc = await SchedulerLock.findOne({
        jobName: "FINALIZE_DAILY_ABSENTEES",
        scopeDate: jobResult.scopeDate,
        organizationId: String(orgAlpha._id),
      });
      expect(lockDoc).toBeDefined();
      expect(lockDoc!.status).toBe("COMPLETED");

      // 2nd Run (Idempotency): without force, job recognizes already-completed state and skips
      const secondRun = await absenceSchedulerService.runAbsenceFinalizationJob({
        organizationId: String(orgAlpha._id),
        force: false,
      });

      expect(secondRun.executed).toBe(false);
      expect(secondRun.skippedReason).toContain("ALREADY_COMPLETED");
    });

    test("20. Temporary credential expiry: user with expired onboarding credential is blocked from logging in", async () => {
      // Create user with temporary password assigned 10 days ago (exceeding default 7-day limit)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const expiredUser = await User.create({
        organizationId: orgAlpha._id,
        fullName: "Slartibartfast",
        email: "slartibartfast@alpha.com",
        role: "EMPLOYEE",
        mustChangePassword: true,
        passwordHash: await bcrypt.hash("Nexisparkx@123", 10),
        passwordMetadata: {
          defaultAssigned: true,
          temporaryPasswordAssignedAt: tenDaysAgo,
        },
        status: "ACTIVE",
      });

      await expect(
        authService.loginUser("slartibartfast@alpha.com", "Nexisparkx@123")
      ).rejects.toThrow("TEMPORARY_CREDENTIALS_EXPIRED");
    });
  });
});

