import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import { app } from "../src/app";
import { connectToDatabase } from "../src/config/database";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import User from "../src/models/User";
import Task from "../src/models/Task";
import Project from "../src/models/Project";
import Meeting from "../src/models/Meeting";
import FileRecord from "../src/models/FileRecord";
import EmployeeDocument from "../src/models/EmployeeDocument";
import Leave from "../src/models/Leave";
import Announcement from "../src/models/Announcement";
import { env } from "../src/config/env";

let mongoServer: MongoMemoryServer;

// Orgs
let orgAId: mongoose.Types.ObjectId;
let orgBId: mongoose.Types.ObjectId;

// Departments
let deptA1Id: mongoose.Types.ObjectId;
let deptA2Id: mongoose.Types.ObjectId;

// Teams
let teamA1Id: mongoose.Types.ObjectId;
let teamA2Id: mongoose.Types.ObjectId;

// Users in Org A
let superAdminId: mongoose.Types.ObjectId;
let adminAId: mongoose.Types.ObjectId;
let hrAId: mongoose.Types.ObjectId;
let managerA1Id: mongoose.Types.ObjectId;
let empA1Id: mongoose.Types.ObjectId;
let empA2Id: mongoose.Types.ObjectId;

// Users in Org B
let empBId: mongoose.Types.ObjectId;

// Tokens
let superAdminToken: string;
let adminAToken: string;
let hrAToken: string;
let managerA1Token: string;
let empA1Token: string;
let empA2Token: string;
let empBToken: string;

function signTestToken(user: any) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      id: user._id.toString(),
      role: user.role,
      organizationId: user.organizationId ? user.organizationId.toString() : undefined,
      departmentId: user.departmentId ? user.departmentId.toString() : undefined,
      teamId: user.teamId ? user.teamId.toString() : undefined,
      employmentType: user.employmentType,
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.JWT_SECRET = env.JWT_SECRET;
  await connectToDatabase();

  // Organizations
  const orgA = await Organization.create({
    organizationId: "org_alpha",
    name: "Alpha Corp",
    code: "ALPHA",
    status: "ACTIVE",
  });
  orgAId = orgA._id as mongoose.Types.ObjectId;

  const orgB = await Organization.create({
    organizationId: "org_beta",
    name: "Beta Corp",
    code: "BETA",
    status: "ACTIVE",
  });
  orgBId = orgB._id as mongoose.Types.ObjectId;

  // Departments in Org A
  const deptA1 = await Department.create({
    organizationId: orgAId,
    name: "Engineering",
    code: "ENG",
    status: "ACTIVE",
  });
  deptA1Id = deptA1._id as mongoose.Types.ObjectId;

  const deptA2 = await Department.create({
    organizationId: orgAId,
    name: "Finance & Accounting",
    code: "FIN",
    status: "ACTIVE",
  });
  deptA2Id = deptA2._id as mongoose.Types.ObjectId;

  // Teams in Org A
  const teamA1 = await Team.create({
    organizationId: orgAId,
    departmentId: deptA1Id,
    name: "Backend Core Team",
    code: "BACKEND",
    status: "ACTIVE",
  });
  teamA1Id = teamA1._id as mongoose.Types.ObjectId;

  const teamA2 = await Team.create({
    organizationId: orgAId,
    departmentId: deptA2Id,
    name: "Payroll Team",
    code: "PAYROLL",
    status: "ACTIVE",
  });
  teamA2Id = teamA2._id as mongoose.Types.ObjectId;

  // Super Admin
  const sAdmin = await User.create({
    fullName: "Super Admin User",
    email: "superadmin@nxworkos.test",
    passwordHash: "hash",
    role: "SUPER_ADMIN",
    employeeId: "SA-001",
    status: "ACTIVE",
  });
  superAdminId = sAdmin._id as mongoose.Types.ObjectId;
  superAdminToken = signTestToken(sAdmin);

  // Admin in Org A
  const admA = await User.create({
    organizationId: orgAId,
    fullName: "Alice Admin",
    email: "alice.admin@alphacorp.test",
    passwordHash: "hash",
    role: "ADMIN",
    employeeId: "ALPHA-ADM",
    status: "ACTIVE",
  });
  adminAId = admA._id as mongoose.Types.ObjectId;
  adminAToken = signTestToken(admA);

  // HR in Org A
  const hrA = await User.create({
    organizationId: orgAId,
    fullName: "Helen HR",
    email: "helen.hr@alphacorp.test",
    passwordHash: "hash",
    role: "HR",
    employeeId: "ALPHA-HR",
    status: "ACTIVE",
  });
  hrAId = hrA._id as mongoose.Types.ObjectId;
  hrAToken = signTestToken(hrA);

  // Manager in Org A (Engineering / Backend team)
  const mgrA1 = await User.create({
    organizationId: orgAId,
    departmentId: deptA1Id,
    teamId: teamA1Id,
    fullName: "Mark Manager",
    email: "mark.mgr@alphacorp.test",
    passwordHash: "hash",
    role: "MANAGER",
    employeeId: "ALPHA-MGR1",
    status: "ACTIVE",
  });
  managerA1Id = mgrA1._id as mongoose.Types.ObjectId;
  managerA1Token = signTestToken(mgrA1);

  // Update teamA1 with managerId
  teamA1.managerId = managerA1Id;
  await teamA1.save();

  // Employee 1 in Org A (Engineering / Backend team, reports to Mark)
  const empA1 = await User.create({
    organizationId: orgAId,
    departmentId: deptA1Id,
    teamId: teamA1Id,
    reportingManagerId: managerA1Id,
    fullName: "Eddie Engineer",
    email: "eddie.eng@alphacorp.test",
    passwordHash: "hash",
    role: "EMPLOYEE",
    employeeId: "ALPHA-EMP1",
    status: "ACTIVE",
  });
  empA1Id = empA1._id as mongoose.Types.ObjectId;
  empA1Token = signTestToken(empA1);

  // Employee 2 in Org A (Finance / Payroll team)
  const empA2 = await User.create({
    organizationId: orgAId,
    departmentId: deptA2Id,
    teamId: teamA2Id,
    fullName: "Fiona Finance",
    email: "fiona.fin@alphacorp.test",
    passwordHash: "hash",
    role: "EMPLOYEE",
    employeeId: "ALPHA-EMP2",
    status: "ACTIVE",
  });
  empA2Id = empA2._id as mongoose.Types.ObjectId;
  empA2Token = signTestToken(empA2);

  // Employee in Org B
  const empB = await User.create({
    organizationId: orgBId,
    fullName: "Bob Beta",
    email: "bob@betacorp.test",
    passwordHash: "hash",
    role: "EMPLOYEE",
    employeeId: "BETA-EMP1",
    status: "ACTIVE",
  });
  empBId = empB._id as mongoose.Types.ObjectId;
  empBToken = signTestToken(empB);

  // Seed tasks
  await Task.create({
    taskId: "TSK-ENG-01",
    organizationId: orgAId,
    title: "Refactor Database Indexing",
    description: "Optimize query indices for search",
    creatorId: managerA1Id,
    assignedBy: managerA1Id,
    assignedTo: empA1Id,
    teamId: teamA1Id,
    departmentId: deptA1Id,
    status: "IN_PROGRESS",
    priority: "HIGH",
  });

  await Task.create({
    taskId: "TSK-FIN-01",
    organizationId: orgAId,
    title: "Prepare Monthly Tax Invoices",
    description: "Tax filings for quarterly close",
    creatorId: adminAId,
    assignedBy: adminAId,
    assignedTo: empA2Id,
    teamId: teamA2Id,
    departmentId: deptA2Id,
    status: "TODO",
    priority: "MEDIUM",
  });

  // Seed files
  await FileRecord.create({
    fileId: "fil_eng_doc",
    organizationId: orgAId,
    originalName: "Engineering_Architecture_Design.pdf",
    storedName: "stored_eng_arch.pdf",
    mimeType: "application/pdf",
    extension: "pdf",
    size: 20480,
    checksum: "chk_eng",
    storagePath: "org_alpha/eng.pdf",
    category: "PROJECT",
    visibility: "ORGANIZATION",
    uploadedBy: empA1Id,
    ownerId: empA1Id,
    status: "ACTIVE",
  });

  await FileRecord.create({
    fileId: "fil_hr_restricted_doc",
    organizationId: orgAId,
    originalName: "Confidential_Salary_Review.pdf",
    storedName: "stored_conf_sal.pdf",
    mimeType: "application/pdf",
    extension: "pdf",
    size: 40960,
    checksum: "chk_sal",
    storagePath: "org_alpha/sal.pdf",
    category: "HR",
    visibility: "HR_RESTRICTED",
    uploadedBy: hrAId,
    ownerId: hrAId,
    status: "ACTIVE",
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("================ 1. GLOBAL SEARCH SECURITY & AUTHORIZATION TESTS ================", () => {
  it("Test 1: Employee CANNOT access Global Search (Returns 403 Forbidden)", async () => {
    const res = await request(app)
      .get("/api/search?q=Engineering")
      .set("Authorization", `Bearer ${empA1Token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("Test 2: Employee suggestions are also blocked with 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/search/suggestions?q=Eng")
      .set("Authorization", `Bearer ${empA1Token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("Test 3: Manager CAN access Global Search and search their own department/team", async () => {
    const res = await request(app)
      .get("/api/search?q=Engineer")
      .set("Authorization", `Bearer ${managerA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results.length).toBeGreaterThan(0);

    // Found Eddie Engineer (in manager's team)
    const titles = res.body.data.results.map((r: any) => r.title);
    expect(titles.some((t: string) => t.includes("Eddie") || t.includes("Engineering"))).toBe(true);
  });

  it("Test 4: Manager CANNOT search or see records from another department/team", async () => {
    const res = await request(app)
      .get("/api/search?q=Finance")
      .set("Authorization", `Bearer ${managerA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Manager is in Engineering. Fiona Finance and Finance Dept should NOT appear in Manager's search
    const titles = res.body.data.results.map((r: any) => r.title);
    expect(titles.some((t: string) => t.includes("Fiona Finance"))).toBe(false);
    expect(titles.some((t: string) => t.includes("Finance & Accounting"))).toBe(false);
  });

  it("Test 5: Manager CANNOT bypass department/team scope using client-supplied parameters", async () => {
    const res = await request(app)
      .get(`/api/search?q=Finance&departmentId=${deptA2Id}&teamId=${teamA2Id}`)
      .set("Authorization", `Bearer ${managerA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const titles = res.body.data.results.map((r: any) => r.title);
    expect(titles.some((t: string) => t.includes("Fiona Finance"))).toBe(false);
  });

  it("Test 6: HR can search across authorized organization scope", async () => {
    const res = await request(app)
      .get("/api/search?q=Finance")
      .set("Authorization", `Bearer ${hrAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const titles = res.body.data.results.map((r: any) => r.title);
    expect(titles.some((t: string) => t.includes("Finance"))).toBe(true);
  });

  it("Test 7: Admin can search all authorized tenant data", async () => {
    const res = await request(app)
      .get("/api/search?q=Engineering")
      .set("Authorization", `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results.length).toBeGreaterThan(0);
  });

  it("Test 8: Cross-tenant search is IMPOSSIBLE (Admin A cannot find Beta Corp data)", async () => {
    const res = await request(app)
      .get("/api/search?q=Beta")
      .set("Authorization", `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.data.results.map((r: any) => r.title);
    expect(titles.some((t: string) => t.includes("Beta"))).toBe(false);
  });

  it("Test 9: Super Admin can search system-wide across organizations", async () => {
    const res = await request(app)
      .get("/api/search?q=Beta")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const titles = res.body.data.results.map((r: any) => r.title);
    expect(titles.some((t: string) => t.includes("Beta"))).toBe(true);
  });

  it("Test 10: HR_RESTRICTED documents DO NOT leak to Manager in search results", async () => {
    const res = await request(app)
      .get("/api/search?q=Salary")
      .set("Authorization", `Bearer ${managerA1Token}`);

    expect(res.status).toBe(200);
    const titles = res.body.data.results.map((r: any) => r.title);
    expect(titles.some((t: string) => t.includes("Salary"))).toBe(false);
  });
});

describe("================ 2. ANNOUNCEMENT MANAGEMENT & SECURITY TESTS ================", () => {
  let globalAncId: string;
  let engDeptAncId: string;
  let scheduledAncId: string;
  let draftAncId: string;
  let archivedAncId: string;
  let targetUserAncId: string;

  it("Test 1: Employee CANNOT create announcement (Returns 403 Forbidden)", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${empA1Token}`)
      .send({
        title: "Unauthorized Employee Announcement",
        message: "This should fail",
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("Test 2: Manager CANNOT create announcement (Returns 403 Forbidden)", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${managerA1Token}`)
      .send({
        title: "Unauthorized Manager Announcement",
        message: "This should fail",
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("Test 3: HR CANNOT create announcement (Only Admin can manage announcements, Returns 403)", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${hrAToken}`)
      .send({
        title: "Unauthorized HR Announcement",
        message: "This should fail",
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("Test 4: Admin CAN create announcements with different audiences and statuses", async () => {
    // 1. ALL published announcement
    const res1 = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        title: "Company Townhall Friday",
        message: "All-hands company townhall meeting this Friday at 4 PM.",
        priority: "HIGH",
        audienceType: "ALL",
        status: "PUBLISHED",
      });

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    globalAncId = res1.body.data.announcement._id;

    // 2. DEPARTMENT published announcement (Engineering only)
    const res2 = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        title: "Engineering Architecture Review",
        message: "Architecture deep dive for Engineering department.",
        priority: "NORMAL",
        audienceType: "DEPARTMENT",
        departmentId: String(deptA1Id),
        status: "PUBLISHED",
      });

    expect(res2.status).toBe(200);
    engDeptAncId = res2.body.data.announcement._id;

    // 3. SCHEDULED announcement for tomorrow
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const res3 = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        title: "Future Scheduled Maintenance",
        message: "System maintenance next week.",
        priority: "LOW",
        audienceType: "ALL",
        status: "SCHEDULED",
        publishAt: tomorrow.toISOString(),
      });

    expect(res3.status).toBe(200);
    scheduledAncId = res3.body.data.announcement._id;

    // 4. DRAFT announcement
    const res4 = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        title: "Draft Policy Update",
        message: "Work in progress draft.",
        priority: "LOW",
        audienceType: "ALL",
        status: "DRAFT",
      });

    expect(res4.status).toBe(200);
    draftAncId = res4.body.data.announcement._id;

    // 5. USER targeted announcement (Eddie only)
    const res5 = await request(app)
      .post("/api/announcements")
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({
        title: "Personal Performance Bonus Notice",
        message: "Confidential bonus notice for Eddie.",
        priority: "URGENT",
        audienceType: "USER",
        targetUserId: String(empA1Id),
        status: "PUBLISHED",
      });

    expect(res5.status).toBe(200);
    targetUserAncId = res5.body.data.announcement._id;
  });

  it("Test 5: Employee in Engineering sees ALL + Engineering announcements + own targeted announcement", async () => {
    const res = await request(app)
      .get("/api/announcements")
      .set("Authorization", `Bearer ${empA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const titles = res.body.data.items.map((a: any) => a.title);
    expect(titles).toContain("Company Townhall Friday");
    expect(titles).toContain("Engineering Architecture Review");
    expect(titles).toContain("Personal Performance Bonus Notice");

    // Must NOT contain scheduled future announcements or drafts
    expect(titles).not.toContain("Future Scheduled Maintenance");
    expect(titles).not.toContain("Draft Policy Update");
  });

  it("Test 6: Employee in Finance does NOT see Engineering department or Eddie's targeted announcement", async () => {
    const res = await request(app)
      .get("/api/announcements")
      .set("Authorization", `Bearer ${empA2Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const titles = res.body.data.items.map((a: any) => a.title);
    expect(titles).toContain("Company Townhall Friday"); // ALL audience is visible
    expect(titles).not.toContain("Engineering Architecture Review"); // Dept mismatch
    expect(titles).not.toContain("Personal Performance Bonus Notice"); // User mismatch
  });

  it("Test 7: Direct GET /api/announcements/:id checks audience authorization (403 for unauthorized user)", async () => {
    // Fiona Finance tries to view Engineering department announcement directly by ID
    const res = await request(app)
      .get(`/api/announcements/${engDeptAncId}`)
      .set("Authorization", `Bearer ${empA2Token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("Test 8: Cross-tenant direct access to announcement returns 403 Forbidden", async () => {
    const res = await request(app)
      .get(`/api/announcements/${globalAncId}`)
      .set("Authorization", `Bearer ${empBToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("Test 9: Employee CAN mark accessible announcement as read", async () => {
    const res = await request(app)
      .post(`/api/announcements/${globalAncId}/read`)
      .set("Authorization", `Bearer ${empA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check unread count calculation
    const countRes = await request(app)
      .get("/api/announcements/unread-count")
      .set("Authorization", `Bearer ${empA1Token}`);

    expect(countRes.status).toBe(200);
    expect(typeof countRes.body.data.unreadCount).toBe("number");
  });

  it("Test 10: Non-admin CANNOT publish, schedule, or archive announcements (403)", async () => {
    // Employee tries to publish
    const res1 = await request(app)
      .post(`/api/announcements/${draftAncId}/publish`)
      .set("Authorization", `Bearer ${empA1Token}`);
    expect(res1.status).toBe(403);

    // Manager tries to schedule
    const res2 = await request(app)
      .post(`/api/announcements/${draftAncId}/schedule`)
      .set("Authorization", `Bearer ${managerA1Token}`)
      .send({ publishAt: new Date().toISOString() });
    expect(res2.status).toBe(403);

    // HR tries to archive
    const res3 = await request(app)
      .post(`/api/announcements/${globalAncId}/archive`)
      .set("Authorization", `Bearer ${hrAToken}`);
    expect(res3.status).toBe(403);
  });

  it("Test 11: Admin CAN publish, schedule, archive, and delete announcements", async () => {
    // Admin publishes draft
    const pubRes = await request(app)
      .post(`/api/announcements/${draftAncId}/publish`)
      .set("Authorization", `Bearer ${adminAToken}`);
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.data.announcement.status).toBe("PUBLISHED");

    // Admin archives announcement
    const archRes = await request(app)
      .post(`/api/announcements/${draftAncId}/archive`)
      .set("Authorization", `Bearer ${adminAToken}`);
    expect(archRes.status).toBe(200);
    expect(archRes.body.data.announcement.status).toBe("ARCHIVED");

    // Admin deletes announcement
    const delRes = await request(app)
      .delete(`/api/announcements/${draftAncId}`)
      .set("Authorization", `Bearer ${adminAToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);
  });
});
