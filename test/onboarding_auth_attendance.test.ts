import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import bcrypt from "bcryptjs";
import Organization from "../src/models/Organization";
import Division from "../src/models/Division";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import User from "../src/models/User";
import Attendance from "../src/models/Attendance";
import Leave from "../src/models/Leave";
import AuditLog from "../src/models/AuditLog";
import { createUser } from "../src/services/userService";
import { loginUser, changePassword } from "../src/services/authService";
import { getUserFromRequest, PasswordChangeRequiredError } from "../src/middleware/auth";
import {
  loginAttendance,
  logoutAttendance,
  getLiveAttendance,
  finalizeDailyAbsentees,
} from "../src/services/attendanceService";
import { DEFAULT_TEMPORARY_PASSWORD } from "../src/validators/auth";

describe("User Onboarding, First Login & Attendance Isolation", () => {
  let mongoServer: MongoMemoryServer;

  let orgAId: mongoose.Types.ObjectId;
  let orgBId: mongoose.Types.ObjectId;
  let divAId: mongoose.Types.ObjectId;
  let divBId: mongoose.Types.ObjectId;
  let deptAId: mongoose.Types.ObjectId;
  let teamAId: mongoose.Types.ObjectId;

  let adminUserA: any;
  let divAdminUserA: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);

    orgAId = new mongoose.Types.ObjectId();
    orgBId = new mongoose.Types.ObjectId();

    await Organization.create([
      {
        _id: orgAId,
        name: "Enterprise Alpha Tenant",
        legalName: "Enterprise Alpha Private Limited",
        status: "ACTIVE",
      },
      {
        _id: orgBId,
        name: "Enterprise Beta Tenant",
        legalName: "Enterprise Beta Corp",
        status: "ACTIVE",
      },
    ]);

    divAId = new mongoose.Types.ObjectId();
    divBId = new mongoose.Types.ObjectId();

    await Division.create([
      {
        _id: divAId,
        organizationId: orgAId,
        name: "Core Engineering Division",
        code: "ENGIN",
        status: "ACTIVE",
      },
      {
        _id: divBId,
        organizationId: orgAId,
        name: "Creative Media Division",
        code: "CREAT",
        status: "ACTIVE",
      },
    ]);

    deptAId = new mongoose.Types.ObjectId();
    await Department.create({
      _id: deptAId,
      organizationId: orgAId,
      divisionId: divAId,
      name: "Software Systems",
      status: "ACTIVE",
    });

    teamAId = new mongoose.Types.ObjectId();
    await Team.create({
      _id: teamAId,
      organizationId: orgAId,
      divisionId: divAId,
      departmentId: deptAId,
      name: "Core Platform Team",
      status: "ACTIVE",
    });

    adminUserA = await User.create({
      fullName: "Org A Admin",
      email: "admin_a_onboarding@nxworkos.test",
      passwordHash: await bcrypt.hash("AdminSecret@123", 10),
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: orgAId,
      status: "ACTIVE",
    });

    divAdminUserA = await User.create({
      fullName: "Division Admin Eng",
      email: "div_admin_eng@nxworkos.test",
      passwordHash: await bcrypt.hash("DivAdminSecret@123", 10),
      role: "DIVISION_ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: orgAId,
      divisionId: divAId,
      status: "ACTIVE",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await Attendance.deleteMany({});
    await Leave.deleteMany({});
    await AuditLog.deleteMany({});
    await User.deleteMany({
      _id: { $nin: [adminUserA._id, divAdminUserA._id] },
    });
  });

  // =========================================================================
  // 1. DEFAULT CREDENTIALS FOR NEW EMPLOYEE / INTERN
  // =========================================================================
  describe("1. New Employee and Intern Default Credentials", () => {
    it("assigns temporary default password 'Nexisparkx@123' and mustChangePassword = true for new EMPLOYEE", async () => {
      const created = await createUser({
        fullName: "Jane Doe Developer",
        email: "jane.dev@nxworkos.test",
        employmentType: "EMPLOYEE",
        role: "EMPLOYEE",
        organizationId: orgAId,
        departmentId: deptAId.toString(),
        teamId: teamAId.toString(),
      });

      expect(created._id).toBeDefined();
      expect(created.mustChangePassword).toBe(true);
      expect((created as any).passwordHash).toBeUndefined(); // Never returned in response

      // Verify persisted state in MongoDB
      const persisted = await User.findById(created._id).select("+passwordHash");
      expect(persisted).not.toBeNull();
      expect(persisted?.mustChangePassword).toBe(true);
      expect(persisted?.passwordMetadata?.defaultAssigned).toBe(true);
      expect(persisted?.passwordHash).not.toBe("Nexisparkx@123"); // Not in plaintext

      // Verify password hash matches Nexisparkx@123
      const isMatch = await bcrypt.compare(DEFAULT_TEMPORARY_PASSWORD, persisted!.passwordHash);
      expect(isMatch).toBe(true);
    });

    it("assigns temporary default password and mustChangePassword = true for new INTERN", async () => {
      const created = await createUser({
        fullName: "Alex Intern",
        email: "alex.intern@nxworkos.test",
        employmentType: "INTERN",
        role: "INTERN",
        organizationId: orgAId,
      });

      expect(created.mustChangePassword).toBe(true);
      const persisted = await User.findById(created._id).select("+passwordHash");
      expect(persisted?.mustChangePassword).toBe(true);
      expect(await bcrypt.compare(DEFAULT_TEMPORARY_PASSWORD, persisted!.passwordHash)).toBe(true);
    });

    it("does not expose password hashes in getUserById or API query results", async () => {
      const created = await createUser({
        fullName: "Secret Hash Check User",
        email: "hash_check@nxworkos.test",
        employmentType: "EMPLOYEE",
        organizationId: orgAId,
      });

      const { getUserById } = await import("../src/services/userService");
      const fetched = await getUserById(created._id.toString());
      expect((fetched as any).passwordHash).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. MANDATORY PASSWORD CHANGE ON FIRST LOGIN
  // =========================================================================
  describe("2. Mandatory Password Change on First Login", () => {
    let employeeUser: any;

    beforeEach(async () => {
      employeeUser = await createUser({
        fullName: "First Login Employee",
        email: "first_login_emp@nxworkos.test",
        employmentType: "EMPLOYEE",
        role: "EMPLOYEE",
        organizationId: orgAId,
      });
    });

    it("loginUser authenticates successfully and returns mustChangePassword = true", async () => {
      const loginRes = await loginUser(employeeUser.email, DEFAULT_TEMPORARY_PASSWORD);

      expect(loginRes.token).toBeDefined();
      expect(loginRes.mustChangePassword).toBe(true);
      expect(loginRes.user.mustChangePassword).toBe(true);
      expect((loginRes.user as any).passwordHash).toBeUndefined();
    });

    it("blocks access to protected endpoints before completing mandatory password change", async () => {
      const loginRes = await loginUser(employeeUser.email, DEFAULT_TEMPORARY_PASSWORD);

      // Create dummy Request for a normal protected route (e.g. /api/users or /api/attendance/today)
      const protectedReq = new Request("http://localhost:3000/api/attendance/today", {
        headers: {
          Authorization: `Bearer ${loginRes.token}`,
        },
      });

      await expect(getUserFromRequest(protectedReq)).rejects.toThrow(PasswordChangeRequiredError);
    });

    it("allows access to password-change and auth check endpoints while password change is pending", async () => {
      const loginRes = await loginUser(employeeUser.email, DEFAULT_TEMPORARY_PASSWORD);

      const changeReq = new Request("http://localhost:3000/api/auth/change-password", {
        headers: {
          Authorization: `Bearer ${loginRes.token}`,
        },
      });

      const meReq = new Request("http://localhost:3000/api/auth/me", {
        headers: {
          Authorization: `Bearer ${loginRes.token}`,
        },
      });

      const userFromChange = await getUserFromRequest(changeReq);
      expect(userFromChange).not.toBeNull();
      expect(userFromChange?.mustChangePassword).toBe(true);

      const userFromMe = await getUserFromRequest(meReq);
      expect(userFromMe).not.toBeNull();
    });

    it("rejects invalid current password during changePassword", async () => {
      await expect(
        changePassword({
          userId: employeeUser._id.toString(),
          currentPassword: "WrongPassword@999",
          newPassword: "BrandNewSecurePassword@2026",
          confirmPassword: "BrandNewSecurePassword@2026",
        })
      ).rejects.toThrow(/INVALID_CURRENT_PASSWORD/);
    });

    it("rejects weak new passwords failing the security policy", async () => {
      const weakPasswords = [
        "short1!",       // < 8 chars
        "alllowercase123!", // No uppercase
        "ALLUPPERCASE123!", // No lowercase
        "NoNumbersOrSpecial", // No number/symbol
      ];

      for (const weak of weakPasswords) {
        await expect(
          changePassword({
            userId: employeeUser._id.toString(),
            currentPassword: DEFAULT_TEMPORARY_PASSWORD,
            newPassword: weak,
            confirmPassword: weak,
          })
        ).rejects.toThrow(/WEAK_PASSWORD/);
      }
    });

    it("rejects new password that is identical to the current temporary password", async () => {
      await expect(
        changePassword({
          userId: employeeUser._id.toString(),
          currentPassword: DEFAULT_TEMPORARY_PASSWORD,
          newPassword: DEFAULT_TEMPORARY_PASSWORD,
          confirmPassword: DEFAULT_TEMPORARY_PASSWORD,
        })
      ).rejects.toThrow(/NEW_PASSWORD_SAME_AS_CURRENT/);
    });

    it("successful password change sets mustChangePassword = false and unlocks normal access", async () => {
      const newPassword = "StrongCustomPassword@2026!";

      const updated = await changePassword({
        userId: employeeUser._id.toString(),
        currentPassword: DEFAULT_TEMPORARY_PASSWORD,
        newPassword,
        confirmPassword: newPassword,
      });

      expect(updated.mustChangePassword).toBe(false);
      expect(updated.passwordChangedAt).toBeInstanceOf(Date);
      expect((updated as any).passwordHash).toBeUndefined();

      // Login with old temporary password must now FAIL
      await expect(
        loginUser(employeeUser.email, DEFAULT_TEMPORARY_PASSWORD)
      ).rejects.toThrow(/INVALID_CREDENTIALS/);

      // Login with new password SUCCEEDS with mustChangePassword = false
      const newLogin = await loginUser(employeeUser.email, newPassword);
      expect(newLogin.mustChangePassword).toBe(false);
      expect(newLogin.token).toBeDefined();

      // Protected requests now SUCCEED
      const protectedReq = new Request("http://localhost:3000/api/attendance/today", {
        headers: {
          Authorization: `Bearer ${newLogin.token}`,
        },
      });

      const authedUser = await getUserFromRequest(protectedReq);
      expect(authedUser).not.toBeNull();
      expect(authedUser?.mustChangePassword).toBe(false);
    });
  });

  // =========================================================================
  // 3. SEPARATE PLATFORM LOGIN FROM ATTENDANCE
  // =========================================================================
  describe("3. Separate Platform Login from Attendance", () => {
    let testUser: any;

    beforeEach(async () => {
      testUser = await createUser({
        fullName: "Attendance Separation User",
        email: "sep_user@nxworkos.test",
        employmentType: "EMPLOYEE",
        role: "EMPLOYEE",
        organizationId: orgAId,
      });

      // Unlock password requirement
      await changePassword({
        userId: testUser._id.toString(),
        currentPassword: DEFAULT_TEMPORARY_PASSWORD,
        newPassword: "SecurePassword@123",
      });
    });

    it("platform login does NOT create a PRESENT attendance record", async () => {
      // Perform platform authentication
      const loginRes = await loginUser(testUser.email, "SecurePassword@123");
      expect(loginRes.token).toBeDefined();

      // Check Attendance in MongoDB
      const todayRecord = await Attendance.findOne({ userId: testUser._id });
      // Either no record exists yet, or if created it must NOT be PRESENT
      if (todayRecord) {
        expect(todayRecord.attendanceStatus).not.toBe("PRESENT");
        expect(todayRecord.attendanceStatus).toBe("NOT_MARKED");
      } else {
        expect(todayRecord).toBeNull();
      }
    });

    it("explicit attendance check-in creates/updates attendance as PRESENT with server timestamp", async () => {
      const beforeTime = new Date();
      const checkInResult = await loginAttendance(testUser._id.toString());
      const afterTime = new Date();

      expect(checkInResult.attendance).toBeDefined();
      expect(["PRESENT", "LATE"]).toContain(checkInResult.attendance.attendanceStatus);
      expect(checkInResult.attendance.firstLoginAt).toBeDefined();

      const serverTimestamp = new Date(checkInResult.attendance.firstLoginAt!).getTime();
      expect(serverTimestamp).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
      expect(serverTimestamp).toBeLessThanOrEqual(afterTime.getTime() + 1000);
    });

    it("check-out records exact server-side logout timestamp and calculates working duration", async () => {
      // Check in first
      await loginAttendance(testUser._id.toString());

      // Check out
      const checkOutResult = await logoutAttendance(testUser._id.toString(), { bypassEod: true });
      expect(checkOutResult.attendance.lastLogoutAt).toBeDefined();
      expect(checkOutResult.session.duration).toBeGreaterThanOrEqual(0);
      expect(["OFFLINE", "LOGGED_OUT"]).toContain(checkOutResult.attendance.currentStatus);
    });
  });

  // =========================================================================
  // 4. ATTENDANCE STATUS RULES & END-OF-DAY CUTOFF
  // =========================================================================
  describe("4. Attendance Status Rules & Cutoff Finalization", () => {
    let userCheckedIn: any;
    let userOnLeave: any;
    let userAbsent: any;

    beforeEach(async () => {
      userCheckedIn = await createUser({
        fullName: "Present User",
        email: "present_user@nxworkos.test",
        organizationId: orgAId,
      });

      userOnLeave = await createUser({
        fullName: "On Leave User",
        email: "onleave_user@nxworkos.test",
        organizationId: orgAId,
      });

      userAbsent = await createUser({
        fullName: "Unchecked Absent User",
        email: "absent_user@nxworkos.test",
        organizationId: orgAId,
      });

      // User 1 performs check-in
      await loginAttendance(userCheckedIn._id.toString());

      // User 2 has an approved leave for today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      await Leave.create({
        userId: userOnLeave._id,
        organizationId: orgAId,
        leaveTypeName: "Casual Leave",
        startDate: todayStart,
        endDate: todayEnd,
        totalDays: 1,
        reason: "Personal medical appointment",
        status: "APPROVED",
        appliedAt: new Date(),
      });
    });

    it("represents user before check-in as NOT_MARKED, not permanently ABSENT", async () => {
      const liveList = await getLiveAttendance({
        userIds: [userAbsent._id.toString()],
        organizationId: orgAId.toString(),
      });

      expect(liveList).toHaveLength(1);
      expect(liveList[0].attendanceStatus).toBe("NOT_MARKED");
    });

    it("finalizeDailyAbsentees marks un-checked-in users without leave as ABSENT, users on leave as ON_LEAVE, and preserves PRESENT", async () => {
      const result = await finalizeDailyAbsentees({ organizationId: orgAId.toString() });

      expect(result.finalizedAbsent).toBeGreaterThanOrEqual(1);
      expect(result.markedOnLeave).toBeGreaterThanOrEqual(1);
      expect(result.alreadyPresent).toBeGreaterThanOrEqual(1);

      // Verify User 1 is still PRESENT
      const att1 = await Attendance.findOne({ userId: userCheckedIn._id });
      expect(["PRESENT", "LATE"]).toContain(att1?.attendanceStatus);

      // Verify User 2 is marked ON_LEAVE
      const att2 = await Attendance.findOne({ userId: userOnLeave._id });
      expect(att2?.attendanceStatus).toBe("ON_LEAVE");

      // Verify User 3 is finalized as ABSENT
      const att3 = await Attendance.findOne({ userId: userAbsent._id });
      expect(att3?.attendanceStatus).toBe("ABSENT");
    });
  });

  // =========================================================================
  // 5. ATTENDANCE VISIBILITY & RBAC
  // =========================================================================
  describe("5. Attendance Visibility and RBAC", () => {
    let divUserA: any;
    let divUserB: any;
    let orgBUser: any;

    beforeEach(async () => {
      divUserA = await createUser({
        fullName: "Div A Employee",
        email: "div_a_emp@nxworkos.test",
        organizationId: orgAId,
        divisionId: divAId.toString(),
      });

      divUserB = await createUser({
        fullName: "Div B Employee",
        email: "div_b_emp@nxworkos.test",
        organizationId: orgAId,
        divisionId: divBId.toString(),
      });

      orgBUser = await createUser({
        fullName: "Org B Employee",
        email: "org_b_emp@nxworkos.test",
        organizationId: orgBId,
      });

      // Check-in divUserA
      await loginAttendance(divUserA._id.toString());
    });

    it("DIVISION_ADMIN only sees attendance for users in their assigned division", async () => {
      const divAdminScope = await getLiveAttendance({
        organizationId: orgAId.toString(),
        divisionId: divAId.toString(),
      });

      const userIds = divAdminScope.map((item: any) => item.userId);
      expect(userIds).toContain(divUserA._id.toString());
      expect(userIds).not.toContain(divUserB._id.toString());
      expect(userIds).not.toContain(orgBUser._id.toString());
    });

    it("ADMIN sees organization-wide attendance, strictly isolated from other tenants", async () => {
      const adminScopeA = await getLiveAttendance({
        organizationId: orgAId.toString(),
      });

      const userIdsA = adminScopeA.map((item: any) => item.userId);
      expect(userIdsA).toContain(divUserA._id.toString());
      expect(userIdsA).toContain(divUserB._id.toString());
      expect(userIdsA).not.toContain(orgBUser._id.toString());
    });

    it("monitoring interface exposes required fields with server timestamps", async () => {
      const records = await getLiveAttendance({
        userIds: [divUserA._id.toString()],
        organizationId: orgAId.toString(),
      });

      expect(records).toHaveLength(1);
      const rec = records[0];
      expect(rec.fullName).toBe("Div A Employee");
      expect(rec.employeeId).toBeDefined();
      expect(rec.employmentType).toBe("EMPLOYEE");
      expect(rec.division).toBeDefined();
      expect(["PRESENT", "LATE"]).toContain(rec.attendanceStatus);
      expect(rec.checkInTime).toBeDefined();
      expect(rec.currentStatus).toBe("ONLINE");
      expect(rec.workDurationText).toBeDefined();
    });
  });
});
