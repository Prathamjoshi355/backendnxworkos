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

describe("Tenant Isolation & Role Security Regression Test Suite", () => {
  let mongoServer: MongoMemoryServer;
  let orgAId: mongoose.Types.ObjectId;
  let orgBId: mongoose.Types.ObjectId;

  let superAdminUser: any;
  let adminAUser: any;
  let adminBUser: any;
  let userA: any;
  let userB: any;

  let superAdminToken: string;
  let adminAToken: string;
  let adminBToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.MONGODB_URI = mongoUri;
    await mongoose.connect(mongoUri);

    orgAId = new mongoose.Types.ObjectId();
    orgBId = new mongoose.Types.ObjectId();

    await Organization.create([
      { _id: orgAId, name: "Tenant Org Alpha", slug: "org-alpha", code: "ALPHA" },
      { _id: orgBId, name: "Tenant Org Beta", slug: "org-beta", code: "BETA" },
    ]);

    superAdminUser = await User.create({
      fullName: "Super Admin Global",
      email: "superadmin_tenant_test@platform.local",
      passwordHash: "hash123",
      employmentType: "EMPLOYEE",
      employeeId: "SA-SEC-01",
      role: "SUPER_ADMIN",
      organizationId: orgAId,
      status: "ACTIVE",
    });

    adminAUser = await User.create({
      fullName: "Admin Tenant A",
      email: "admin_a_tenant_test@platform.local",
      passwordHash: "hash123",
      employmentType: "EMPLOYEE",
      employeeId: "ADM-A-01",
      role: "ADMIN",
      organizationId: orgAId,
      status: "ACTIVE",
    });

    adminBUser = await User.create({
      fullName: "Admin Tenant B",
      email: "admin_b_tenant_test@platform.local",
      passwordHash: "hash123",
      employmentType: "EMPLOYEE",
      employeeId: "ADM-B-01",
      role: "ADMIN",
      organizationId: orgBId,
      status: "ACTIVE",
    });

    userA = await User.create({
      fullName: "Employee Alpha",
      email: "employee_alpha_tenant_test@platform.local",
      passwordHash: "hash123",
      employmentType: "EMPLOYEE",
      employeeId: "EMP-A-01",
      role: "EMPLOYEE",
      organizationId: orgAId,
      status: "ACTIVE",
    });

    userB = await User.create({
      fullName: "Employee Beta",
      email: "employee_beta_tenant_test@platform.local",
      passwordHash: "hash123",
      employmentType: "EMPLOYEE",
      employeeId: "EMP-B-01",
      role: "EMPLOYEE",
      organizationId: orgBId,
      status: "ACTIVE",
    });

    superAdminToken = signToken(superAdminUser);
    adminAToken = signToken(adminAUser);
    adminBToken = signToken(adminBUser);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // TEST A: ADMIN from Org A creates user with organizationId = Org B
  it("TEST A: ADMIN from Organization A creates user with organizationId = Org B -> scoped to Org A", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        fullName: "Test User A Cross Attempt",
        email: "test_cross_user_a@platform.local",
        password: "Password123!",
        role: "EMPLOYEE",
        organizationId: String(orgBId), // Malicious attempt to inject Org B
      });

    expect(res.status).toBe(200);
    const createdUserId = res.body?.data?.user?._id;
    expect(createdUserId).toBeDefined();

    // Verify MongoDB state: created user's organizationId must be Org A, NOT Org B
    const dbUser = await User.findById(createdUserId).lean();
    expect(dbUser).not.toBeNull();
    expect(String(dbUser!.organizationId)).toBe(String(orgAId));
    expect(String(dbUser!.organizationId)).not.toBe(String(orgBId));

    // Verify Audit Log
    const audit = await AuditLog.findOne({
      action: "USER_CREATED",
      entityId: String(createdUserId),
    }).lean();
    expect(audit).not.toBeNull();
    expect(String(audit!.organizationId)).toBe(String(orgAId));
  });

  // TEST B: ADMIN from Org A attempts to delete user from Org B
  it("TEST B: ADMIN from Organization A attempts to delete user from Organization B -> 403 Forbidden", async () => {
    const res = await request(app)
      .delete(`/api/users/${userB._id}`)
      .set("Authorization", `Bearer ${adminAToken}`);

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("FORBIDDEN");

    // Verify MongoDB state: target user still exists and remains ACTIVE
    const dbUserB = await User.findById(userB._id).lean();
    expect(dbUserB).not.toBeNull();
    expect(dbUserB!.status).toBe("ACTIVE");
    expect(String(dbUserB!.organizationId)).toBe(String(orgBId));

    // Verify Audit Log of the blocked attempt
    const audit = await AuditLog.findOne({
      action: "SECURITY_VIOLATION_CROSS_TENANT_DELETE",
      actorId: String(adminAUser._id),
    }).lean();
    expect(audit).not.toBeNull();
  });

  // TEST C: ADMIN from Org A attempts to PATCH user from Org B
  it("TEST C: ADMIN from Organization A attempts to PATCH user from Organization B -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/users/${userB._id}`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        fullName: "Hacked Name By Org A Admin",
        title: "Injected Title",
      });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("FORBIDDEN");

    // Verify MongoDB state: target user unchanged
    const dbUserB = await User.findById(userB._id).lean();
    expect(dbUserB).not.toBeNull();
    expect(dbUserB!.fullName).toBe("Employee Beta");
    expect(String(dbUserB!.organizationId)).toBe(String(orgBId));
  });

  // TEST D: ADMIN attempts to modify SUPER_ADMIN
  it("TEST D: ADMIN attempts to modify SUPER_ADMIN -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/users/${superAdminUser._id}`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        fullName: "Tampered Super Admin",
      });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("FORBIDDEN");

    // Verify MongoDB state
    const dbSuperAdmin = await User.findById(superAdminUser._id).lean();
    expect(dbSuperAdmin!.fullName).toBe("Super Admin Global");

    // Also verify DELETE on SUPER_ADMIN by ADMIN
    const deleteRes = await request(app)
      .delete(`/api/users/${superAdminUser._id}`)
      .set("Authorization", `Bearer ${adminAToken}`);

    expect(deleteRes.status).toBe(403);
    const dbSuperAdminAfter = await User.findById(superAdminUser._id).lean();
    expect(dbSuperAdminAfter!.status).toBe("ACTIVE");
  });

  // TEST E: ADMIN attempts to create SUPER_ADMIN
  it("TEST E: ADMIN attempts to create SUPER_ADMIN -> 403 Forbidden", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        fullName: "Malicious Super Admin Attempt",
        email: "malicious_sa@platform.local",
        password: "Password123!",
        role: "SUPER_ADMIN",
      });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("FORBIDDEN");

    // Verify MongoDB state: no such user created
    const dbCreated = await User.findOne({ email: "malicious_sa@platform.local" }).lean();
    expect(dbCreated).toBeNull();

    // Verify audit log
    const audit = await AuditLog.findOne({
      action: "SECURITY_VIOLATION_ROLE_ESCALATION",
      actorId: String(adminAUser._id),
    }).lean();
    expect(audit).not.toBeNull();
  });

  // TEST F: ADMIN attempts mass assignment
  it("TEST F: ADMIN attempts mass assignment (role=SUPER_ADMIN, permissions=['*'], organizationId=Org B) -> sanitized / rejected", async () => {
    // Attempt 1: on user creation
    const createRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        fullName: "Mass Assignment Candidate",
        email: "mass_assign_test@platform.local",
        password: "Password123!",
        role: "SUPER_ADMIN",
        permissions: ["*"],
        organizationId: String(orgBId),
        isSuperAdmin: true,
      });

    // Should be rejected because role=SUPER_ADMIN
    expect(createRes.status).toBe(403);

    // Attempt 2: valid role creation with injection of orgB, permissions, isSuperAdmin
    const validRoleCreateRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        fullName: "Mass Assignment Candidate 2",
        email: "mass_assign_test_2@platform.local",
        password: "Password123!",
        role: "EMPLOYEE",
        permissions: ["admin.all", "*"],
        organizationId: String(orgBId),
        isSuperAdmin: true,
      });

    expect(validRoleCreateRes.status).toBe(200);
    const userId2 = validRoleCreateRes.body?.data?.user?._id;
    const dbUser2 = await User.findById(userId2).lean();
    expect(dbUser2).not.toBeNull();
    // Org must be Org A
    expect(String(dbUser2!.organizationId)).toBe(String(orgAId));
    // isSuperAdmin must not be true
    expect((dbUser2 as any).isSuperAdmin).not.toBe(true);

    // Attempt 3: mass assignment on PATCH
    const patchRes = await request(app)
      .patch(`/api/users/${userId2}`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        role: "SUPER_ADMIN",
        permissions: ["*"],
        organizationId: String(orgBId),
        isSuperAdmin: true,
        title: "Valid Title Update",
      });

    // If role=SUPER_ADMIN is passed in PATCH by ADMIN, it's rejected 403
    expect(patchRes.status).toBe(403);

    // Attempt 4: PATCH with allowed role but injected organizationId
    const patchOrgRes = await request(app)
      .patch(`/api/users/${userId2}`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        organizationId: String(orgBId),
        designation: "Senior Lead Engineer",
      });

    expect(patchOrgRes.status).toBe(200);
    const dbUser2AfterPatch = await User.findById(userId2).lean();
    // Org must remain Org A (injected organizationId stripped)
    expect(String(dbUser2AfterPatch!.organizationId)).toBe(String(orgAId));
    expect(dbUser2AfterPatch!.designation).toBe("Senior Lead Engineer");
  });

  // TEST G: SUPER_ADMIN performs an allowed cross-organization operation
  it("TEST G: SUPER_ADMIN performs allowed cross-organization user creation and updates", async () => {
    // SUPER_ADMIN creates user explicitly in Org B
    const createRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        fullName: "Super Admin Created User in B",
        email: "sa_created_in_b@platform.local",
        password: "Password123!",
        role: "EMPLOYEE",
        organizationId: String(orgBId),
      });

    expect(createRes.status).toBe(200);
    const newUserId = createRes.body?.data?.user?._id;
    const dbCreatedInB = await User.findById(newUserId).lean();
    expect(dbCreatedInB).not.toBeNull();
    expect(String(dbCreatedInB!.organizationId)).toBe(String(orgBId));

    // SUPER_ADMIN updates user in Org B
    const patchRes = await request(app)
      .patch(`/api/users/${newUserId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        designation: "Platform Manager",
      });

    expect(patchRes.status).toBe(200);
    const dbUpdatedInB = await User.findById(newUserId).lean();
    expect(dbUpdatedInB!.designation).toBe("Platform Manager");

    // SUPER_ADMIN deactivates user in Org B
    const deleteRes = await request(app)
      .delete(`/api/users/${newUserId}`)
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(deleteRes.status).toBe(200);
    const dbDeletedInB = await User.findById(newUserId).lean();
    expect(["RESIGNED", "INACTIVE"]).toContain(dbDeletedInB!.status);
  });

  // Cross-tenant access endpoint tests
  it("Cross-tenant user access endpoint: ADMIN cannot view or edit permissions of user in Org B", async () => {
    // GET access of user in Org B
    const getRes = await request(app)
      .get(`/api/users/${userB._id}/access`)
      .set("Authorization", `Bearer ${adminAToken}`);

    expect(getRes.status).toBe(403);

    // PATCH access of user in Org B
    const patchRes = await request(app)
      .patch(`/api/users/${userB._id}/access`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        role: "MANAGER",
      });

    expect(patchRes.status).toBe(403);
  });
});
