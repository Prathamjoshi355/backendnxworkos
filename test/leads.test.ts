import request from "supertest";
import { app } from "../src/app";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import User, { IUser } from "../src/models/User";
import Lead from "../src/models/Lead";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { connectToDatabase, disconnectDatabase } from "../src/config/database";

let mongoServer: MongoMemoryServer;

const createObjectId = () => new mongoose.Types.ObjectId();
const hashPassword = async (password: string) => bcryptjs.hash(password, 10);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-leads-test' },
  });
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.JWT_SECRET = "__test_jwt_secret__";
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await Lead.deleteMany({});
  await Organization.deleteMany({});
  await Department.deleteMany({});
  await Team.deleteMany({});
});

function createToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "7d",
  });
}

describe("Lead Management - Critical Tests", () => {
  test("1. Sales employee can access assigned sales leads", async () => {
    // Create organization and sales employee
    const orgId = createObjectId();
    const managerId = createObjectId();

    const org = await Organization.create({
      _id: orgId,
      name: "Sales Corp",
      status: "ACTIVE",
    });

    const passwordHash = await hashPassword("password");

    const salesUser = await User.create({
      fullName: "Sales Employee",
      email: "sales@example.com",
      passwordHash,
      role: "SALES_EXECUTIVE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      departmentId: "sales-dept",
      teamId: "sales-team",
      status: "ACTIVE",
      permissions: ["lead.view.self", "lead.create", "lead.call"],
    });

    const devUser = await User.create({
      fullName: "Developer",
      email: "dev@example.com",
      passwordHash,
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      departmentId: "dev-dept",
      status: "ACTIVE",
      permissions: ["task.view"],
    });

    // Create a sales lead assigned to sales employee
    const lead = await Lead.create({
      leadId: "NX-LEAD-0001",
      organizationId: orgId,
      departmentId: "sales-dept",
      assignedTo: salesUser._id,
      createdBy: salesUser._id,
      name: "Customer A",
      phone: "1234567890",
      email: "customer@example.com",
      company: "Acme Corp",
      priority: "HIGH",
      status: "NEW",
      pipelineStage: "NEW",
    });

    const token = createToken(salesUser._id.toString(), "SALES_EXECUTIVE");

    const res = await request(app)
      .get("/api/leads")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.leads).toHaveLength(1);
    expect(res.body.data.leads[0].name).toBe("Customer A");
  });

  test("2. Developer cannot access sales leads", async () => {
    const orgId = createObjectId();

    const passwordHash = await hashPassword("password");

    const devUser = await User.create({
      fullName: "Developer",
      email: "dev@example.com",
      passwordHash,
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      departmentId: "dev-dept",
      status: "ACTIVE",
      permissions: ["task.view"], // No lead permissions
    });

    const salesUser = await User.create({
      fullName: "Sales Employee",
      email: "sales@example.com",
      passwordHash,
      role: "SALES_EXECUTIVE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      departmentId: "sales-dept",
      status: "ACTIVE",
      permissions: ["lead.view.self"],
    });

    // Create a sales lead
    const lead = await Lead.create({
      leadId: "NX-LEAD-0001",
      organizationId: orgId,
      departmentId: "sales-dept",
      assignedTo: salesUser._id,
      createdBy: salesUser._id,
      name: "Customer B",
      phone: "9876543210",
      status: "NEW",
      pipelineStage: "NEW",
    });

    // Try to access as developer
    const token = createToken(devUser._id.toString(), "EMPLOYEE");

    const res = await request(app)
      .get("/api/leads")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("3. Duplicate detection prevents duplicate phone numbers", async () => {
    const orgId = createObjectId();
    const passwordHash = await hashPassword("password");

    const user = await User.create({
      fullName: "Sales User",
      email: "sales@example.com",
      passwordHash,
      role: "SALES_EXECUTIVE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      status: "ACTIVE",
      permissions: ["lead.create", "lead.view.self"],
    });

    // Create first lead
    await Lead.create({
      leadId: "NX-LEAD-0001",
      organizationId: orgId,
      createdBy: user._id,
      name: "Customer A",
      phone: "1234567890",
      email: "customerA@example.com",
      status: "NEW",
      pipelineStage: "NEW",
    });

    const token = createToken(user._id.toString(), "SALES_EXECUTIVE");

    // Try to create duplicate with same phone
    const res = await request(app)
      .post("/api/leads")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Customer A Duplicate",
        phone: "1234567890",
        email: "customerB@example.com",
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LEAD_DUPLICATE");
  });

  test("4. Bulk import validates and creates leads correctly", async () => {
    const orgId = createObjectId();
    const passwordHash = await hashPassword("password");

    const user = await User.create({
      fullName: "Admin User",
      email: "admin@example.com",
      passwordHash,
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      status: "ACTIVE",
      permissions: ["lead.import", "lead.create", "lead.view.self"],
    });

    const token = createToken(user._id.toString(), "ADMIN");

    const res = await request(app)
      .post("/api/leads/import")
      .set("Authorization", `Bearer ${token}`)
      .send({
        leads: [
          {
            name: "Customer 1",
            phone: "1111111111",
            email: "cust1@example.com",
            company: "Company A",
            priority: "HIGH",
          },
          {
            name: "Customer 2",
            phone: "2222222222",
            email: "cust2@example.com",
            company: "Company B",
            priority: "MEDIUM",
          },
          {
            name: "Invalid Lead", // Missing phone
            phone: "",
            email: "invalid@example.com",
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.successful).toBe(2);
    expect(res.body.data.failed).toBeGreaterThan(0);
  });

  test("5. Call logging creates history correctly", async () => {
    const orgId = createObjectId();
    const passwordHash = await hashPassword("password");

    const user = await User.create({
      fullName: "Sales User",
      email: "sales@example.com",
      passwordHash,
      role: "SALES_EXECUTIVE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      status: "ACTIVE",
      permissions: ["lead.call", "lead.view.self"],
    });

    const lead = await Lead.create({
      leadId: "NX-LEAD-0001",
      organizationId: orgId,
      assignedTo: user._id,
      createdBy: user._id,
      name: "Customer",
      phone: "1234567890",
      status: "NEW",
      pipelineStage: "NEW",
    });

    const token = createToken(user._id.toString(), "SALES_EXECUTIVE");

    const res = await request(app)
      .post(`/api/leads/${lead.leadId}/calls`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        startedAt: new Date().toISOString(),
        outcome: "CONNECTED",
        notes: "Customer interested",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.callLog.outcome).toBe("CONNECTED");

    // Verify call history
    const historyRes = await request(app)
      .get(`/api/leads/${lead.leadId}/calls`)
      .set("Authorization", `Bearer ${token}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.calls).toHaveLength(1);
  });

  test("6. CRM analytics applies scope filtering correctly", async () => {
    const orgId = createObjectId();
    const passwordHash = await hashPassword("password");

    const adminUser = await User.create({
      fullName: "Admin",
      email: "admin@example.com",
      passwordHash,
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      departmentId: "sales-dept",
      status: "ACTIVE",
      permissions: ["lead.view.self"],
    });

    // Create leads in different departments
    await Lead.create({
      leadId: "NX-LEAD-0001",
      organizationId: orgId,
      departmentId: "sales-dept",
      createdBy: adminUser._id,
      name: "Sales Lead",
      phone: "1111111111",
      status: "NEW",
      pipelineStage: "NEW",
    });

    await Lead.create({
      leadId: "NX-LEAD-0002",
      organizationId: orgId,
      departmentId: "hr-dept",
      createdBy: adminUser._id,
      name: "HR Lead",
      phone: "2222222222",
      status: "NEW",
      pipelineStage: "NEW",
    });

    const token = createToken(adminUser._id.toString(), "ADMIN");

    const res = await request(app)
      .get("/api/leads/analytics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Admin with sales-dept should only see sales leads
    expect(res.body.data.analytics.totalLeads).toBe(1);
  });

  test("7. Unauthorized direct API call returns 403", async () => {
    const orgId = createObjectId();
    const passwordHash = await hashPassword("password");

    const devUser = await User.create({
      fullName: "Developer",
      email: "dev@example.com",
      passwordHash,
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      status: "ACTIVE",
      permissions: ["task.view"],
    });

    const token = createToken(devUser._id.toString(), "EMPLOYEE");

    // Try to call lead API without permission
    const res = await request(app)
      .get("/api/leads")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("8. Follow-up creation and completion workflow", async () => {
    const orgId = createObjectId();
    const passwordHash = await hashPassword("password");

    const user = await User.create({
      fullName: "Sales User",
      email: "sales@example.com",
      passwordHash,
      role: "SALES_EXECUTIVE",
      employmentType: "EMPLOYEE",
      organizationId: orgId,
      status: "ACTIVE",
      permissions: ["lead.followup", "lead.view.self"],
    });

    const lead = await Lead.create({
      leadId: "NX-LEAD-0001",
      organizationId: orgId,
      assignedTo: user._id,
      createdBy: user._id,
      name: "Customer",
      phone: "1234567890",
      status: "NEW",
      pipelineStage: "NEW",
    });

    const token = createToken(user._id.toString(), "SALES_EXECUTIVE");

    // Create follow-up
    const createRes = await request(app)
      .post(`/api/leads/${lead.leadId}/followups`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        reason: "Check interest",
      });

    expect(createRes.status).toBe(201);
    const followUpId = createRes.body.data.followUp._id;

    // Complete follow-up
    const completeRes = await request(app)
      .post(`/api/followups/${followUpId}/complete`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        notes: "Customer confirmed interest",
      });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.followUp.status).toBe("COMPLETED");
  });
});
