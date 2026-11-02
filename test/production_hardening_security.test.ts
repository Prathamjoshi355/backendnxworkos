import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../src/app";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Task from "../src/models/Task";
import FileRecord from "../src/models/FileRecord";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import { connectToDatabase, disconnectDatabase } from "../src/config/database";
import { env } from "../src/config/env";
import { checkRateLimit, resetRateLimitStore } from "../src/middleware/rateLimiter";

let mongoServer: MongoMemoryServer;
const JWT_SECRET = env.JWT_SECRET;

function generateToken(user: any, expiresIn = "1h", secret = JWT_SECRET) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      organizationId: user.organizationId?.toString(),
    },
    secret,
    { expiresIn } as any
  );
}

describe("TASK 18 — Production Hardening & Security Audit Test Suite", () => {
  let orgA: any;
  let orgB: any;
  let superAdminUser: any;
  let adminUser: any;
  let employeeA: any;
  let employeeB: any;
  let suspendedUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongoServer.getUri();
    await connectToDatabase();

    // Seed Organizations
    orgA = await Organization.create({
      name: "Acme Corp Org A",
      code: "ORG-A",
      domain: "acmea.com",
    });

    orgB = await Organization.create({
      name: "Beta Corp Org B",
      code: "ORG-B",
      domain: "betab.com",
    });

    // Seed Users
    superAdminUser = await User.create({
      fullName: "Super Administrator",
      email: "superadmin@nxworkos.test",
      passwordHash: "hash123",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    });

    adminUser = await User.create({
      fullName: "Admin User",
      email: "admin@acmea.com",
      passwordHash: "hash123",
      role: "ADMIN",
      organizationId: orgA._id,
      status: "ACTIVE",
    });

    employeeA = await User.create({
      fullName: "Employee Alice",
      email: "alice@acmea.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      organizationId: orgA._id,
      status: "ACTIVE",
    });

    employeeB = await User.create({
      fullName: "Employee Bob",
      email: "bob@betab.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      organizationId: orgB._id,
      status: "ACTIVE",
    });

    suspendedUser = await User.create({
      fullName: "Suspended Employee",
      email: "suspended@acmea.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      organizationId: orgA._id,
      status: "SUSPENDED",
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(() => {
    resetRateLimitStore();
  });

  describe("1. Authentication & Session Hardening", () => {
    it("rejects request with missing Authorization header", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects request with malformed token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer invalid-malformed-token-string");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects request with expired token", async () => {
      const expiredToken = jwt.sign(
        { sub: employeeA._id.toString(), role: employeeA.role },
        JWT_SECRET,
        { expiresIn: "-10s" }
      );
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects request with token signed by invalid secret", async () => {
      const forgedToken = generateToken(employeeA, "1h", "forged-attacker-secret");
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${forgedToken}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects suspended / deactivated user even with a valid signed token", async () => {
      const suspendedToken = generateToken(suspendedUser);
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${suspendedToken}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("2. HTTP Security Headers & Method Handling", () => {
    it("returns standard production security headers on all responses", async () => {
      const res = await request(app).get("/api/health/live");
      expect(res.status).toBe(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["x-xss-protection"]).toBe("0");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(res.headers["access-control-allow-origin"]).toBeDefined();
    });

    it("responds with HTTP 204 to CORS preflight OPTIONS requests", async () => {
      const res = await request(app).options("/api/auth/login");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-methods"]).toContain("GET");
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
    });

    it("returns consistent 404 envelope for unknown endpoints", async () => {
      const res = await request(app).get("/api/non-existent-endpoint-test");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe("NOT_FOUND");
    });

    it("returns 405 Method Not Allowed for unsupported methods", async () => {
      const res = await request(app).delete("/api/auth/login");
      expect(res.status).toBe(405);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe("METHOD_NOT_ALLOWED");
    });
  });

  describe("3. Tenant Isolation & IDOR Protection", () => {
    let taskA: any;

    beforeAll(async () => {
      taskA = await Task.create({
        taskId: "TASK-SEC-101",
        title: "Confidential Project Strategy Org A",
        description: "Internal org A roadmap",
        organizationId: orgA._id,
        creatorId: adminUser._id,
        assignedTo: employeeA._id,
        assignedBy: adminUser._id,
        status: "TODO",
        priority: "HIGH",
      });
    });

    it("allows assigned employee within same organization to query task", async () => {
      const tokenA = generateToken(employeeA);
      const res = await request(app)
        .get("/api/tasks")
        .set("Authorization", `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const items = res.body.data?.items || res.body.data?.tasks || [];
      const found = items.some((t: any) => t._id === taskA._id.toString() || t.title === taskA.title);
      expect(found).toBe(true);
    });

    it("strictly isolates Employee B (Org B) from search (403) and Admin B from seeing Org A tasks in global search", async () => {
      const tokenB = generateToken(employeeB);
      const resEmp = await request(app)
        .get("/api/search?q=Confidential")
        .set("Authorization", `Bearer ${tokenB}`);
      expect(resEmp.status).toBe(403);

      const adminB = await User.create({
        email: "admin_b_search@orgb.com",
        passwordHash: "hash123",
        role: "ADMIN",
        organizationId: orgB._id,
        fullName: "Admin B",
        firstName: "Admin",
        lastName: "B",
      });
      const tokenAdminB = generateToken(adminB);
      const resAdmin = await request(app)
        .get("/api/search?q=Confidential")
        .set("Authorization", `Bearer ${tokenAdminB}`);
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.success).toBe(true);
      const foundInSearch = resAdmin.body.data?.results?.some((r: any) => r.id === taskA._id.toString());
      expect(foundInSearch).toBe(false);
    });

    it("blocks regular employee from vertical privilege escalation to Admin Health / Roles", async () => {
      const tokenA = generateToken(employeeA);
      const resHealth = await request(app)
        .get("/api/admin/health")
        .set("Authorization", `Bearer ${tokenA}`);
      expect([401, 403]).toContain(resHealth.status);

      const resRoles = await request(app)
        .get("/api/admin/roles")
        .set("Authorization", `Bearer ${tokenA}`);
      expect([401, 403]).toContain(resRoles.status);
    });

    it("blocks non-super-admin from enumerating organizations in search", async () => {
      const tokenAdmin = generateToken(adminUser);
      const res = await request(app)
        .get("/api/search?q=Acme&type=organizations")
        .set("Authorization", `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.results).toHaveLength(0);
    });
  });

  describe("4. File & Document Storage Security", () => {
    let hrRestrictedFile: any;

    beforeAll(async () => {
      hrRestrictedFile = await FileRecord.create({
        fileId: "FILE-HR-101",
        filename: "confidential_executive_payroll_2026.pdf",
        originalName: "confidential_executive_payroll_2026.pdf",
        storedName: "stored_confidential_payroll_2026.pdf",
        storagePath: "/storage/orgA/confidential_executive_payroll_2026.pdf",
        mimeType: "application/pdf",
        extension: "pdf",
        size: 1024,
        sizeBytes: 1024,
        checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        organizationId: orgA._id,
        ownerId: adminUser._id,
        uploadedBy: adminUser._id,
        category: "HR",
        accessLevel: "HR_RESTRICTED",
        tags: ["payroll", "executive"],
      });
    });

    it("blocks regular employee from accessing HR_RESTRICTED file download", async () => {
      const tokenA = generateToken(employeeA);
      const res = await request(app)
        .get(`/api/files/${hrRestrictedFile._id}/download`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect([401, 403, 404]).toContain(res.status);
    });

    it("blocks cross-tenant file download by Employee B from Org B", async () => {
      const tokenB = generateToken(employeeB);
      const res = await request(app)
        .get(`/api/files/${hrRestrictedFile._id}/download`)
        .set("Authorization", `Bearer ${tokenB}`);
      expect([401, 403, 404]).toContain(res.status);
    });
  });

  describe("5. Rate Limiting Engine", () => {
    it("tracks sliding window requests and allows within limit", () => {
      const result1 = checkRateLimit("test-ip-1", { max: 3, windowMs: 10000 });
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);

      const result2 = checkRateLimit("test-ip-1", { max: 3, windowMs: 10000 });
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);

      const result3 = checkRateLimit("test-ip-1", { max: 3, windowMs: 10000 });
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(0);

      const result4 = checkRateLimit("test-ip-1", { max: 3, windowMs: 10000 });
      expect(result4.allowed).toBe(false);
      expect(result4.remaining).toBe(0);
    });
  });

  describe("6. Observability & Health Probes", () => {
    it("GET /api/health/live returns 200 with alive status", async () => {
      const res = await request(app).get("/api/health/live");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("alive");
      expect(res.body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it("GET /api/health/ready returns 200 with ready status and database state", async () => {
      const res = await request(app).get("/api/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ready");
      expect(res.body.data.database.status).toBe("connected");
    });

    it("GET /api/health returns 200 base health check", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("healthy");
    });
  });

  describe("7. Sensitive HR & Payroll Privilege Gating", () => {
    it("blocks regular employee without compensation permissions from accessing compensation endpoints", async () => {
      const tokenA = generateToken(employeeA);
      const res = await request(app)
        .get(`/api/compensation/${employeeB._id}`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect([401, 403, 404]).toContain(res.status);
    });

    it("allows Admin to access organization-scoped HR/compensation records", async () => {
      const tokenAdmin = generateToken(adminUser);
      const res = await request(app)
        .get(`/api/compensation/${employeeA._id}`)
        .set("Authorization", `Bearer ${tokenAdmin}`);
      // Either returns 200 or 404 (not found in DB), but never 401/403 forbidden
      expect([200, 404]).toContain(res.status);
    });
  });

  describe("8. Error Response Sanitization & Stack Masking", () => {
    it("never exposes internal stack traces or database connection strings on error", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "invalid@nonexistent.domain", password: "wrong" });
      expect(res.status).toBe(401);
      expect(res.body.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("mongodb://");
      expect(JSON.stringify(res.body)).not.toContain("JWT_SECRET");
    });
  });
});
