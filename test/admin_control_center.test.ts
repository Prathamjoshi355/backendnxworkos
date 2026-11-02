import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import { app } from "../src/app";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import AuditLog from "../src/models/AuditLog";
import SystemSetting from "../src/models/SystemSetting";

import { env } from "../src/config/env";

function signToken(user: { _id: string | mongoose.Types.ObjectId; email: string; role: string; organizationId: string | mongoose.Types.ObjectId }) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      email: user.email,
      organizationId: String(user.organizationId),
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

describe("Admin & Super Admin Control Center End-to-End Tests", () => {
  let mongoServer: MongoMemoryServer;
  let orgAId: mongoose.Types.ObjectId;
  let orgBId: mongoose.Types.ObjectId;
  let superAdminUser: any;
  let adminAUser: any;
  let adminBUser: any;
  let employeeAUser: any;

  let superAdminToken: string;
  let adminAToken: string;
  let adminBToken: string;
  let employeeAToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.MONGODB_URI = mongoUri;
    await mongoose.connect(mongoUri);

    // Clean test collections
    await Promise.all([
      Organization.deleteMany({ name: { $in: ["Org Alpha Governance", "Org Beta Governance", "Provisioned New Org"] } }),
      User.deleteMany({ email: { $in: ["sa_cc@test.com", "admin_a_cc@test.com", "admin_b_cc@test.com", "emp_a_cc@test.com"] } }),
      AuditLog.deleteMany({ summary: { $regex: /Governance|Control Center/i } }),
      SystemSetting.deleteMany({ key: { $in: ["session_timeout", "password_min_length", "auto_checkout_minutes"] } }),
    ]);

    // Create Organizations
    const [orgA, orgB] = await Promise.all([
      Organization.create({
        name: "Org Alpha Governance",
        legalName: "Alpha Corp Ltd",
        email: "contact@alpha.com",
        status: "ACTIVE",
        workingHours: { workStartTime: "09:00", workEndTime: "18:00", gracePeriodMinutes: 15 },
      }),
      Organization.create({
        name: "Org Beta Governance",
        legalName: "Beta Solutions LLC",
        email: "contact@beta.com",
        status: "ACTIVE",
        workingHours: { workStartTime: "10:00", workEndTime: "19:00", gracePeriodMinutes: 10 },
      }),
    ]);

    orgAId = orgA._id as mongoose.Types.ObjectId;
    orgBId = orgB._id as mongoose.Types.ObjectId;

    // Create Users
    [superAdminUser, adminAUser, adminBUser, employeeAUser] = await Promise.all([
      User.create({
        fullName: "Super Admin Governance",
        email: "sa_cc@test.com",
        passwordHash: "hash123",
        role: "SUPER_ADMIN",
        employmentType: "EMPLOYEE",
        employeeId: "SA-CC-01",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
      User.create({
        fullName: "Admin Alpha",
        email: "admin_a_cc@test.com",
        passwordHash: "hash123",
        role: "ADMIN",
        employmentType: "EMPLOYEE",
        employeeId: "ADM-A-01",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
      User.create({
        fullName: "Admin Beta",
        email: "admin_b_cc@test.com",
        passwordHash: "hash123",
        role: "ADMIN",
        employmentType: "EMPLOYEE",
        employeeId: "ADM-B-01",
        organizationId: orgBId,
        status: "ACTIVE",
      }),
      User.create({
        fullName: "Employee Alpha",
        email: "emp_a_cc@test.com",
        passwordHash: "hash123",
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        employeeId: "EMP-A-01",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
    ]);

    superAdminToken = signToken(superAdminUser);
    adminAToken = signToken(adminAUser);
    adminBToken = signToken(adminBUser);
    employeeAToken = signToken(employeeAUser);

    // Create seed department & team
    const deptA = await Department.create({
      name: "Engineering Governance",
      code: "ENG-GOV",
      organizationId: orgAId,
      status: "ACTIVE",
    });

    await Team.create({
      name: "Core Platform",
      code: "CORE-PLT",
      departmentId: deptA._id,
      organizationId: orgAId,
      status: "ACTIVE",
    });

    // Create seed audit logs
    await AuditLog.create([
      {
        organizationId: orgAId,
        actorId: adminAUser._id,
        actorRole: "ADMIN",
        action: "ROLE_CHANGED",
        entityType: "USER",
        entityId: employeeAUser._id,
        summary: "Governance test role change",
      },
      {
        organizationId: orgBId,
        actorId: adminBUser._id,
        actorRole: "ADMIN",
        action: "AUTH_FAILED",
        entityType: "AUTH",
        summary: "Governance test failed login",
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe("1. Authorization & Role-Based Access Control", () => {
    it("denies unauthenticated requests to Control Center endpoints", async () => {
      const res = await request(app).get("/api/admin/control-center");
      expect(res.status).toBe(401);
    });

    it("denies regular Employee from accessing Control Center overview (403 Forbidden)", async () => {
      const res = await request(app)
        .get("/api/admin/control-center")
        .set("Authorization", `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it("denies regular Employee from accessing Security Center (403 Forbidden)", async () => {
      const res = await request(app)
        .get("/api/admin/security")
        .set("Authorization", `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it("denies regular Employee from accessing System Health (403 Forbidden)", async () => {
      const res = await request(app)
        .get("/api/admin/health")
        .set("Authorization", `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it("denies regular Employee from accessing Audit Logs (403 Forbidden)", async () => {
      const res = await request(app)
        .get("/api/audit-logs")
        .set("Authorization", `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it("denies regular Employee from viewing or updating System Settings (403 Forbidden)", async () => {
      const resGet = await request(app)
        .get("/api/settings")
        .set("Authorization", `Bearer ${employeeAToken}`);
      expect(resGet.status).toBe(403);

      const resPatch = await request(app)
        .patch("/api/settings")
        .set("Authorization", `Bearer ${employeeAToken}`)
        .send({ key: "session_timeout", value: 30 });
      expect(resPatch.status).toBe(403);
    });
  });

  describe("2. Organization Scoping & Tenant Isolation", () => {
    it("Admin A receives only Org A governance overview, cannot access Org B", async () => {
      // Legitimate Org A access
      const resA = await request(app)
        .get("/api/admin/control-center")
        .set("Authorization", `Bearer ${adminAToken}`);
      expect(resA.status).toBe(200);
      expect(resA.body.success).toBe(true);
      expect(resA.body.data.scope.organizationId).toBe(String(orgAId));
      expect(resA.body.data.scope.isSuperAdmin).toBe(false);

      // Attempt to breach to Org B
      const resBreach = await request(app)
        .get(`/api/admin/control-center?organizationId=${orgBId}`)
        .set("Authorization", `Bearer ${adminAToken}`);
      expect(resBreach.status).toBe(403);
      expect(resBreach.body.error.message).toMatch(/another organization/i);
    });

    it("Admin A cannot query Audit Logs of Org B", async () => {
      const res = await request(app)
        .get(`/api/audit-logs?organizationId=${orgBId}`)
        .set("Authorization", `Bearer ${adminAToken}`);
      expect(res.status).toBe(403);
    });

    it("Admin A cannot modify settings of Org B", async () => {
      const res = await request(app)
        .patch("/api/settings")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          organizationId: String(orgBId),
          key: "session_timeout",
          value: 60,
          category: "SECURITY",
        });
      expect(res.status).toBe(403);
    });

    it("Admin A cannot inspect or modify Org B details directly", async () => {
      const resGet = await request(app)
        .get(`/api/organizations/${orgBId}`)
        .set("Authorization", `Bearer ${adminAToken}`);
      expect(resGet.status).toBe(403);

      const resPatch = await request(app)
        .patch(`/api/organizations/${orgBId}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ legalName: "Illegally Renamed" });
      expect(resPatch.status).toBe(403);
    });

    it("Admin A cannot create a new tenant organization (Super Admin only)", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          name: "Unauthorized Tenant Org",
          status: "ACTIVE",
        });
      expect(res.status).toBe(403);
    });
  });

  describe("3. Super Admin Platform Capabilities", () => {
    it("Super Admin can access platform-wide Control Center overview", async () => {
      const res = await request(app)
        .get("/api/admin/control-center")
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scope.isSuperAdmin).toBe(true);
      expect(res.body.data.overview.hierarchy.organizations).toBeGreaterThanOrEqual(2);
    });

    it("Super Admin can provision a new tenant organization", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Provisioned New Org",
          legalName: "New Org Provisioning Ltd",
          email: "provisioned@neworg.com",
          status: "ACTIVE",
          workingHours: { workStartTime: "09:30", workEndTime: "18:30" },
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organization.name).toBe("Provisioned New Org");
    });

    it("Super Admin can query cross-org audit logs and filter by organization", async () => {
      const resGlobal = await request(app)
        .get("/api/audit-logs")
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect(resGlobal.status).toBe(200);
      expect(resGlobal.body.data.items.length).toBeGreaterThanOrEqual(2);

      const resFiltered = await request(app)
        .get(`/api/audit-logs?organizationId=${orgAId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect(resFiltered.status).toBe(200);
      expect(resFiltered.body.data.items.every((item: any) => String(item.organizationId) === String(orgAId))).toBe(true);
    });

    it("Super Admin can inspect platform roles and canonical permissions matrix", async () => {
      const res = await request(app)
        .get("/api/admin/roles")
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.roles).toContain("SUPER_ADMIN");
      expect(res.body.data.roles).toContain("ADMIN");
      expect(res.body.data.roles).toContain("MANAGER");
      expect(res.body.data.rolePermissions.SUPER_ADMIN).toContain("organization.manage");
    });
  });

  describe("4. Security Center, Telemetry & Health", () => {
    it("returns real security metrics and recent privileged events", async () => {
      const res = await request(app)
        .get("/api/admin/security")
        .set("Authorization", `Bearer ${adminAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics).toBeDefined();
      expect(typeof res.body.data.metrics.failedLogins).toBe("number");
      expect(typeof res.body.data.metrics.lockedOrSuspendedAccounts).toBe("number");
      expect(typeof res.body.data.metrics.activeSessions).toBe("number");
      expect(Array.isArray(res.body.data.recentPrivilegedEvents)).toBe(true);
    });

    it("returns real system health with MongoDB status, uptime, and memory usage", async () => {
      const res = await request(app)
        .get("/api/admin/health")
        .set("Authorization", `Bearer ${adminAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("healthy");
      expect(res.body.data.database.status).toBe("connected");
      expect(res.body.data.system.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.data.system.memoryUsage.rssMb).toBeGreaterThan(0);
      expect(typeof res.body.data.realtime.socketEnabled).toBe("boolean");
    });
  });

  describe("5. Persistent Configuration & Settings", () => {
    it("Admin A updates persistent security setting for Org A", async () => {
      const patchRes = await request(app)
        .patch("/api/settings")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          key: "session_timeout",
          value: 45,
          category: "SECURITY",
        });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.setting.key).toBe("session_timeout");
      expect(patchRes.body.data.setting.value).toBe(45);
      expect(patchRes.body.data.setting.category).toBe("SECURITY");

      // Verify persistence via GET
      const getRes = await request(app)
        .get("/api/settings?category=SECURITY")
        .set("Authorization", `Bearer ${adminAToken}`);
      expect(getRes.status).toBe(200);
      const found = getRes.body.data.settings.find((s: any) => s.key === "session_timeout");
      expect(found).toBeDefined();
      expect(found.value).toBe(45);
    });
  });

  describe("6. Audit Log Immutability", () => {
    it("does not permit DELETE or PATCH on audit logs", async () => {
      const deleteRes = await request(app)
        .delete("/api/audit-logs")
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect([404, 405]).toContain(deleteRes.status);

      const patchRes = await request(app)
        .patch("/api/audit-logs")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ summary: "Tampered" });
      expect([404, 405]).toContain(patchRes.status);
    });
  });
});
