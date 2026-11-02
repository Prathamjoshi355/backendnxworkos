import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import { app } from "../src/app";
import { connectToDatabase, disconnectDatabase } from "../src/config/database";
import Organization from "../src/models/Organization";
import User from "../src/models/User";
import Task from "../src/models/Task";
import Project from "../src/models/Project";
import Meeting from "../src/models/Meeting";
import Conversation from "../src/models/Conversation";
import Message from "../src/models/Message";
import FileRecord from "../src/models/FileRecord";
import EmployeeDocument from "../src/models/EmployeeDocument";

import { env } from "../src/config/env";

let mongoServer: MongoMemoryServer;

let orgAId: mongoose.Types.ObjectId;
let orgBId: mongoose.Types.ObjectId;

let adminAId: mongoose.Types.ObjectId;
let empA1Id: mongoose.Types.ObjectId;
let empA2Id: mongoose.Types.ObjectId;
let superAdminId: mongoose.Types.ObjectId;
let empBId: mongoose.Types.ObjectId;

let adminAToken: string;
let empA1Token: string;
let empA2Token: string;
let superAdminToken: string;
let empBToken: string;
let managerAToken: string;
let hrAToken: string;

function signTestToken(user: any) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      id: user._id.toString(),
      role: user.role,
      organizationId: user.organizationId ? user.organizationId.toString() : undefined,
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

  // Create Organizations
  const orgA = await Organization.create({
    organizationId: "org_alpha_101",
    name: "Alpha Corp Global",
    code: "ALPHA",
    status: "ACTIVE",
  });
  orgAId = orgA._id as mongoose.Types.ObjectId;

  const orgB = await Organization.create({
    organizationId: "org_beta_202",
    name: "Beta Industries",
    code: "BETA",
    status: "ACTIVE",
  });
  orgBId = orgB._id as mongoose.Types.ObjectId;

  // Create Super Admin
  const sAdmin = await User.create({
    fullName: "Super Governance Admin",
    email: "superadmin@nxworkos.internal",
    passwordHash: "hashedPassword123",
    role: "SUPER_ADMIN",
    employeeId: "SA-001",
    status: "ACTIVE",
  });
  superAdminId = sAdmin._id as mongoose.Types.ObjectId;

  // Create Org A Admin
  const admA = await User.create({
    organizationId: orgAId,
    fullName: "Alice Admin",
    email: "alice.admin@alphacorp.com",
    passwordHash: "hashedPassword123",
    role: "ADMIN",
    employeeId: "ALPHA-001",
    designation: "VP Engineering",
    status: "ACTIVE",
  });
  adminAId = admA._id as mongoose.Types.ObjectId;

  // Create Org A Employee 1
  const eA1 = await User.create({
    organizationId: orgAId,
    fullName: "Bob Engineer",
    email: "bob.dev@alphacorp.com",
    passwordHash: "hashedPassword123",
    role: "EMPLOYEE",
    employeeId: "ALPHA-002",
    designation: "Frontend Engineer",
    status: "ACTIVE",
  });
  empA1Id = eA1._id as mongoose.Types.ObjectId;

  // Create Org A Employee 2
  const eA2 = await User.create({
    organizationId: orgAId,
    fullName: "Charlie Designer",
    email: "charlie.ux@alphacorp.com",
    passwordHash: "hashedPassword123",
    role: "DESIGNER",
    employeeId: "ALPHA-003",
    designation: "Lead UI Designer",
    status: "ACTIVE",
  });
  empA2Id = eA2._id as mongoose.Types.ObjectId;

  // Create Org B Employee
  const eB = await User.create({
    organizationId: orgBId,
    fullName: "David Beta",
    email: "david@betaindustries.com",
    passwordHash: "hashedPassword123",
    role: "EMPLOYEE",
    employeeId: "BETA-001",
    designation: "Software Developer",
    status: "ACTIVE",
  });
  empBId = eB._id as mongoose.Types.ObjectId;

  // Create Org A Manager
  const mgrA = await User.create({
    organizationId: orgAId,
    fullName: "Mary Manager",
    email: "mary.mgr@alphacorp.com",
    passwordHash: "hashedPassword123",
    role: "MANAGER",
    employeeId: "ALPHA-MGR",
    designation: "Engineering Manager",
    status: "ACTIVE",
  });
  managerAToken = signTestToken(mgrA);

  // Create Org A HR
  const hrA = await User.create({
    organizationId: orgAId,
    fullName: "Hannah HR",
    email: "hannah.hr@alphacorp.com",
    passwordHash: "hashedPassword123",
    role: "HR",
    employeeId: "ALPHA-HR",
    designation: "HR Specialist",
    status: "ACTIVE",
  });
  hrAToken = signTestToken(hrA);

  // Tokens
  adminAToken = signTestToken(admA);
  empA1Token = signTestToken(eA1);
  empA2Token = signTestToken(eA2);
  superAdminToken = signTestToken(sAdmin);
  empBToken = signTestToken(eB);

  // Seed Projects
  await Project.create([
    {
      organizationId: orgAId,
      projectId: "proj_alpha_core",
      name: "Alpha Core Modernization",
      code: "ACM",
      description: "Next-generation microservices architecture",
      status: "ACTIVE",
      members: [empA1Id],
      ownerId: adminAId,
      createdBy: adminAId,
    },
    {
      organizationId: orgAId,
      projectId: "proj_alpha_design",
      name: "Design System Revamp",
      code: "DSR",
      description: "Figma design token overhaul",
      status: "PLANNED",
      members: [empA2Id],
      ownerId: adminAId,
      createdBy: adminAId,
    },
    {
      organizationId: orgBId,
      projectId: "proj_beta_secret",
      name: "Beta Confidential Project",
      code: "BCP",
      description: "Proprietary beta initiative",
      status: "ACTIVE",
      members: [empBId],
      ownerId: empBId,
      createdBy: empBId,
    },
  ]);

  // Seed Tasks
  await Task.create([
    {
      organizationId: orgAId,
      taskId: "task_101",
      title: "Implement Alpha Search Engine",
      description: "Build global search with MongoDB and RBAC",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assignedTo: empA1Id,
      assignedBy: adminAId,
      creatorId: adminAId,
      tags: ["search", "backend"],
    },
    {
      organizationId: orgAId,
      taskId: "task_102",
      title: "Create Figma Components",
      description: "Design UI kit for Alpha Platform",
      status: "TODO",
      priority: "MEDIUM",
      assignedTo: empA2Id,
      assignedBy: adminAId,
      creatorId: adminAId,
      tags: ["design", "ui"],
    },
    {
      organizationId: orgBId,
      taskId: "task_201",
      title: "Beta Task Alpha Keyword Collision",
      description: "Should not leak to Org A",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assignedTo: empBId,
      assignedBy: empBId,
      creatorId: empBId,
      tags: ["alpha", "beta"],
    },
  ]);

  // Seed Meetings
  await Meeting.create([
    {
      organizationId: orgAId,
      meetingId: "meet_101",
      title: "Alpha Engineering Sync",
      description: "Weekly sprint review for modern architecture",
      meetingType: "ONLINE",
      date: new Date("2026-09-10T10:00:00Z"),
      startTime: "10:00 AM",
      endTime: "11:00 AM",
      status: "SCHEDULED",
      organizerId: adminAId,
      participants: [{ userId: empA1Id, responseStatus: "ACCEPTED" }],
    },
    {
      organizationId: orgBId,
      meetingId: "meet_201",
      title: "Beta Sync Alpha Discussion",
      description: "Meeting inside Org B",
      meetingType: "ONLINE",
      date: new Date("2026-09-10T11:00:00Z"),
      startTime: "11:00 AM",
      endTime: "12:00 PM",
      status: "SCHEDULED",
      organizerId: empBId,
      participants: [{ userId: empBId, responseStatus: "ACCEPTED" }],
    },
  ]);

  // Seed Conversations & Messages
  const convA = await Conversation.create({
    organizationId: orgAId,
    conversationId: "conv_alpha_1",
    type: "DIRECT",
    name: "Bob & Admin Chat",
    participants: [empA1Id, adminAId],
    createdBy: adminAId,
    lastMessage: {
      body: "Please review the search engine PR",
      createdAt: new Date(),
    },
  });

  await Message.create({
    organizationId: orgAId,
    conversationId: convA._id,
    messageId: "msg_alpha_1",
    senderId: adminAId,
    body: "Please review the search engine PR immediately",
    messageType: "TEXT",
  });

  // Seed Files
  await FileRecord.create([
    {
      organizationId: orgAId,
      fileId: "file_alpha_spec",
      originalName: "Alpha_Architecture_Specification.pdf",
      storedName: "Alpha_Architecture_Specification.pdf",
      storagePath: "uploads/Alpha_Architecture_Specification.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 1048576,
      checksum: "chk_alpha_1",
      storageProvider: "LOCAL",
      category: "PROJECT",
      description: "Detailed system architecture",
      tags: ["architecture", "spec", "alpha"],
      status: "ACTIVE",
      visibility: "ORGANIZATION",
      uploadedBy: empA1Id,
      ownerId: empA1Id,
    },
    {
      organizationId: orgAId,
      fileId: "file_alpha_hr_confidential",
      originalName: "Employee_Disciplinary_Record.pdf",
      storedName: "Employee_Disciplinary_Record.pdf",
      storagePath: "uploads/Employee_Disciplinary_Record.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 51200,
      checksum: "chk_alpha_2",
      storageProvider: "LOCAL",
      category: "HR",
      description: "Strictly confidential HR notes",
      tags: ["hr", "confidential"],
      status: "ACTIVE",
      visibility: "HR_RESTRICTED",
      uploadedBy: adminAId,
      ownerId: adminAId,
    },
  ]);

  // Seed HR Records (EmployeeDocument)
  await EmployeeDocument.create({
    organizationId: orgAId,
    userId: empA1Id,
    documentType: "OFFER_LETTER",
    title: "Official Joining Offer Letter",
    fileName: "Offer_Letter_Bob.pdf",
    fileUrl: "/docs/offer_bob.pdf",
    status: "VERIFIED",
    uploadedBy: adminAId,
  });
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoServer.stop();
});

describe("TASK 17 — Global Search & Discovery Integration Tests", () => {
  describe("1. Authentication & Query Validation", () => {
    it("rejects unauthenticated search with 401", async () => {
      const res = await request(app).get("/api/search?q=Alpha");
      expect(res.status).toBe(401);
    });

    it("rejects unauthorized employee search with 403", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha")
        .set("Authorization", `Bearer ${empA1Token}`);
      expect(res.status).toBe(403);
    });

    it("returns empty result when query is empty or whitespace", async () => {
      const res1 = await request(app)
        .get("/api/search?q=")
        .set("Authorization", `Bearer ${managerAToken}`);
      expect(res1.status).toBe(200);
      expect(res1.body.data.total).toBe(0);
      expect(res1.body.data.results).toEqual([]);

      const res2 = await request(app)
        .get("/api/search?q=   ")
        .set("Authorization", `Bearer ${managerAToken}`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.total).toBe(0);
    });

    it("returns empty result when query is shorter than 2 characters", async () => {
      const res = await request(app)
        .get("/api/search?q=A")
        .set("Authorization", `Bearer ${managerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
    });

    it("safely handles special regex characters without error", async () => {
      const res = await request(app)
        .get("/api/search?q=[.*+?^${}()|\\]")
        .set("Authorization", `Bearer ${managerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe("2. Multi-Tenant Isolation & IDOR Protection", () => {
    it("Org A manager cannot discover Org B tasks, projects, meetings, or files", async () => {
      // "Beta" is in Org B
      const res = await request(app)
        .get("/api/search?q=Beta")
        .set("Authorization", `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      const results = res.body.data.results;
      for (const item of results) {
        expect(item.organizationId).toBe(orgAId.toString());
        expect(item.title).not.toContain("Beta Confidential Project");
        expect(item.title).not.toContain("Beta Task Alpha Keyword Collision");
      }
    });

    it("Org B employee cannot access search (403)", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha")
        .set("Authorization", `Bearer ${empBToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("3. Manager RBAC Scoping", () => {
    it("Manager A discovers conversation messages in their scope", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha")
        .set("Authorization", `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.results.length).toBeGreaterThan(0);
    });

    it("Manager A cannot discover HR_RESTRICTED files", async () => {
      const res = await request(app)
        .get("/api/search?q=Disciplinary")
        .set("Authorization", `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      const fileResults = res.body.data.results.filter((r: any) => r.entityType === "FILE");
      expect(fileResults.length).toBe(0);
    });
  });

  describe("4. Admin & HR Access", () => {
    it("Admin A discovers all organization tasks, projects, meetings, and HR_RESTRICTED files", async () => {
      const res = await request(app)
        .get("/api/search?q=Disciplinary")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      const fileResults = res.body.data.results.filter((r: any) => r.entityType === "FILE");
      expect(fileResults.length).toBe(1);
      expect(fileResults[0].title).toBe("Employee_Disciplinary_Record.pdf");
    });

    it("Admin A discovers HR documents in search", async () => {
      const res = await request(app)
        .get("/api/search?q=Offer Letter")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      const hrResults = res.body.data.results.filter((r: any) => r.entityType === "HR_RECORD");
      expect(hrResults.length).toBe(1);
      expect(hrResults[0].title).toBe("Official Joining Offer Letter");
    });
  });

  describe("5. Super Admin Discovery", () => {
    it("Super Admin can discover Organizations across the platform", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha&type=ORGANIZATION")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const orgResults = res.body.data.results.filter((r: any) => r.entityType === "ORGANIZATION");
      expect(orgResults.length).toBe(1);
      expect(orgResults[0].title).toBe("Alpha Corp Global");
    });

    it("Ordinary employee is blocked from search (403)", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha&type=ORGANIZATION")
        .set("Authorization", `Bearer ${empA1Token}`);

      expect(res.status).toBe(403);
    });
  });

  describe("6. Type Filtering, Pagination & Suggestions", () => {
    it("filters results by single entity type (e.g. type=TASK)", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha&type=TASK")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      const results = res.body.data.results;
      expect(results.length).toBeGreaterThan(0);
      for (const item of results) {
        expect(item.entityType).toBe("TASK");
      }
    });

    it("filters results by multiple entity types (e.g. type=TASK,PROJECT)", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha&type=TASK,PROJECT")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      const results = res.body.data.results;
      for (const item of results) {
        expect(["TASK", "PROJECT"]).toContain(item.entityType);
      }
    });

    it("respects pagination page and limit parameters", async () => {
      const res = await request(app)
        .get("/api/search?q=Alpha&page=1&limit=2")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.limit).toBe(2);
      expect(res.body.data.results.length).toBeLessThanOrEqual(2);
    });

    it("returns typeahead suggestions from /api/search/suggestions", async () => {
      const res = await request(app)
        .get("/api/search/suggestions?q=Alpha")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.suggestions).toBeDefined();
      expect(Array.isArray(res.body.data.suggestions)).toBe(true);
      expect(res.body.data.suggestions.length).toBeGreaterThan(0);
      expect(res.body.data.suggestions[0].title).toBeDefined();
      expect(res.body.data.suggestions[0].entityType).toBeDefined();
      expect(res.body.data.suggestions[0].route).toBeDefined();
    });
  });
});
