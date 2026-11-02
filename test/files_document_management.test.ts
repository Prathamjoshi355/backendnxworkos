import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import { app } from "../src/app";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import FileRecord from "../src/models/FileRecord";
import Folder from "../src/models/Folder";
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

describe("Task 16: Files / Document Management End-to-End Integration Tests", () => {
  let mongoServer: MongoMemoryServer;
  let orgAId: mongoose.Types.ObjectId;
  let orgBId: mongoose.Types.ObjectId;

  let superAdminUser: any;
  let adminAUser: any;
  let hrAUser: any;
  let employeeA1User: any;
  let employeeA2User: any;
  let adminBUser: any;

  let superAdminToken: string;
  let adminAToken: string;
  let hrAToken: string;
  let employeeA1Token: string;
  let employeeA2Token: string;
  let adminBToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.MONGODB_URI = mongoUri;
    await mongoose.connect(mongoUri);

    // Create Organizations
    const [orgA, orgB] = await Promise.all([
      Organization.create({
        name: "Org Alpha Files",
        legalName: "Alpha Files Corp",
        slug: "org-alpha-files",
        status: "ACTIVE",
      }),
      Organization.create({
        name: "Org Beta Files",
        legalName: "Beta Files Corp",
        slug: "org-beta-files",
        status: "ACTIVE",
      }),
    ]);
    orgAId = orgA._id as mongoose.Types.ObjectId;
    orgBId = orgB._id as mongoose.Types.ObjectId;

    // Create Users across roles & tenants
    [superAdminUser, adminAUser, hrAUser, employeeA1User, employeeA2User, adminBUser] = await Promise.all([
      User.create({
        email: "sa_files@test.com",
        passwordHash: "hash123",
        fullName: "Super Admin Files",
        role: "SUPER_ADMIN",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
      User.create({
        email: "admin_a_files@test.com",
        passwordHash: "hash123",
        fullName: "Admin A Files",
        role: "ADMIN",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
      User.create({
        email: "hr_a_files@test.com",
        passwordHash: "hash123",
        fullName: "HR A Files",
        role: "HR",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
      User.create({
        email: "emp_a1_files@test.com",
        passwordHash: "hash123",
        fullName: "Emp A1 Files",
        role: "EMPLOYEE",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
      User.create({
        email: "emp_a2_files@test.com",
        passwordHash: "hash123",
        fullName: "Emp A2 Files",
        role: "EMPLOYEE",
        organizationId: orgAId,
        status: "ACTIVE",
      }),
      User.create({
        email: "admin_b_files@test.com",
        passwordHash: "hash123",
        fullName: "Admin B Files",
        role: "ADMIN",
        organizationId: orgBId,
        status: "ACTIVE",
      }),
    ]);

    superAdminToken = signToken(superAdminUser);
    adminAToken = signToken(adminAUser);
    hrAToken = signToken(hrAUser);
    employeeA1Token = signToken(employeeA1User);
    employeeA2Token = signToken(employeeA2User);
    adminBToken = signToken(adminBUser);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("1. Authentication & Security Validation", () => {
    it("should return 401 when no auth token is provided", async () => {
      const res = await request(app).get("/api/files");
      expect(res.status).toBe(401);
    });

    it("should reject blocked executable extensions (.exe)", async () => {
      const res = await request(app)
        .post("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          fileName: "malware.exe",
          fileData: Buffer.from("MZ malicious payload").toString("base64"),
          category: "GENERAL",
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.message || res.body.message || "").toMatch(/BLOCKED_FILE_EXTENSION/i);
    });

    it("should sanitize path traversal attempts in file names", async () => {
      // Send a text file with path traversal in name
      const res = await request(app)
        .post("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          fileName: "../../../etc/passwd.txt",
          fileData: Buffer.from("safe sample text content").toString("base64"),
          category: "GENERAL",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.file.originalName).toBe("passwd.txt");
      expect(res.body.data.file.originalName).not.toContain("..");
      expect(res.body.data.file.checksum).toBeDefined();
    });
  });

  describe("2. Folder Management", () => {
    let createdFolderId: string;

    it("should create a folder for Org A", async () => {
      const res = await request(app)
        .post("/api/files/folders")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          name: "Project Specifications",
          category: "PROJECT",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.folder.name).toBe("Project Specifications");
      expect(res.body.data.folder.folderId).toBeDefined();
      createdFolderId = res.body.data.folder.folderId;
    });

    it("should list folders scoped to organization", async () => {
      const resA = await request(app)
        .get("/api/files/folders")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(resA.status).toBe(200);
      expect(resA.body.data.folders.length).toBeGreaterThanOrEqual(1);
      expect(resA.body.data.folders.some((f: any) => f.folderId === createdFolderId)).toBe(true);

      // Org B admin should NOT see Org A folders
      const resB = await request(app)
        .get("/api/files/folders")
        .set("Authorization", `Bearer ${adminBToken}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data.folders.some((f: any) => f.folderId === createdFolderId)).toBe(false);
    });

    it("should delete a folder", async () => {
      const createRes = await request(app)
        .post("/api/files/folders")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ name: "Temporary Folder" });

      const tempFolderId = createRes.body.data.folder.folderId;

      const delRes = await request(app)
        .delete(`/api/files/folders/${tempFolderId}`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(delRes.status).toBe(200);

      // Verify it is no longer returned in active list
      const listRes = await request(app)
        .get("/api/files/folders")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(listRes.body.data.folders.some((f: any) => f.folderId === tempFolderId)).toBe(false);
    });
  });

  describe("3. File Upload, Metadata & Download", () => {
    let uploadedFileId: string;
    const fileContent = "NXWorkOS Architecture Document v1.0 Enterprise Edition";

    it("should upload a file and compute sha256 checksum", async () => {
      const res = await request(app)
        .post("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          fileName: "Architecture_Overview.txt",
          fileData: Buffer.from(fileContent).toString("base64"),
          category: "PROJECT",
          description: "Core architecture document",
          tags: ["architecture", "spec", "backend"],
          visibility: "ORGANIZATION",
        });

      expect(res.status).toBe(201);
      const file = res.body.data.file;
      expect(file.fileId).toBeDefined();
      expect(file.originalName).toBe("Architecture_Overview.txt");
      expect(file.version).toBe(1);
      expect(file.checksum).toBeDefined();
      expect(file.size).toBe(Buffer.byteLength(fileContent));
      uploadedFileId = file.fileId;
    });

    it("should retrieve file metadata by fileId", async () => {
      const res = await request(app)
        .get(`/api/files/${uploadedFileId}`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.file.fileId).toBe(uploadedFileId);
      expect(res.body.data.file.originalName).toBe("Architecture_Overview.txt");
    });

    it("should securely download file buffer with correct headers", async () => {
      const res = await request(app)
        .get(`/api/files/${uploadedFileId}/download`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toContain("Architecture_Overview.txt");
      expect((res.text || res.body).toString()).toBe(fileContent);
    });

    it("should update file metadata", async () => {
      const res = await request(app)
        .patch(`/api/files/${uploadedFileId}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          description: "Updated core architecture description",
          tags: ["architecture", "v2"],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.file.description).toBe("Updated core architecture description");
      expect(res.body.data.file.tags).toEqual(["architecture", "v2"]);
    });
  });

  describe("4. Multi-Tenant Isolation & IDOR Protection", () => {
    let orgAFileId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          fileName: "OrgA_Confidential_Financials.txt",
          fileData: Buffer.from("Strictly Org A Financial Secrets").toString("base64"),
          category: "CONTRACT",
          visibility: "ORGANIZATION",
        });
      orgAFileId = res.body.data.file.fileId;
    });

    it("should NOT allow Org B user to view Org A file metadata (IDOR protection)", async () => {
      const res = await request(app)
        .get(`/api/files/${orgAFileId}`)
        .set("Authorization", `Bearer ${adminBToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it("should NOT allow Org B user to download Org A file content", async () => {
      const res = await request(app)
        .get(`/api/files/${orgAFileId}/download`)
        .set("Authorization", `Bearer ${adminBToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it("should NOT allow Org B user to update Org A file metadata", async () => {
      const res = await request(app)
        .patch(`/api/files/${orgAFileId}`)
        .set("Authorization", `Bearer ${adminBToken}`)
        .send({ description: "Hacked by Org B" });

      expect([403, 404]).toContain(res.status);
    });

    it("should NOT allow Org B user to delete Org A file", async () => {
      const res = await request(app)
        .delete(`/api/files/${orgAFileId}`)
        .set("Authorization", `Bearer ${adminBToken}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  describe("5. HR Document Confidentiality", () => {
    let empA1HrFileId: string;

    beforeAll(async () => {
      // Employee A1 uploads a personal HR medical document
      const res = await request(app)
        .post("/api/files")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({
          fileName: "EmpA1_Medical_Leave_Certificate.txt",
          fileData: Buffer.from("Medical certificate details").toString("base64"),
          category: "HR",
          visibility: "HR_RESTRICTED",
          employeeId: String(employeeA1User._id),
        });
      empA1HrFileId = res.body.data.file.fileId;
    });

    it("should allow Employee A1 to download their own HR document", async () => {
      const res = await request(app)
        .get(`/api/files/${empA1HrFileId}/download`)
        .set("Authorization", `Bearer ${employeeA1Token}`);

      expect(res.status).toBe(200);
      expect((res.text || res.body).toString()).toBe("Medical certificate details");
    });

    it("should NOT allow Employee A2 to access Employee A1's HR document", async () => {
      const res = await request(app)
        .get(`/api/files/${empA1HrFileId}`)
        .set("Authorization", `Bearer ${employeeA2Token}`);

      expect([403, 404]).toContain(res.status);

      const dlRes = await request(app)
        .get(`/api/files/${empA1HrFileId}/download`)
        .set("Authorization", `Bearer ${employeeA2Token}`);

      expect([403, 404]).toContain(dlRes.status);
    });

    it("should allow HR and Admin to access Employee A1's HR document", async () => {
      const hrRes = await request(app)
        .get(`/api/files/${empA1HrFileId}`)
        .set("Authorization", `Bearer ${hrAToken}`);

      expect(hrRes.status).toBe(200);

      const adminRes = await request(app)
        .get(`/api/files/${empA1HrFileId}/download`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(adminRes.status).toBe(200);
      expect((adminRes.text || adminRes.body).toString()).toBe("Medical certificate details");
    });
  });

  describe("6. Versioning System", () => {
    let versionedFileId: string;
    const v1Content = "Draft Contract Version 1";
    const v2Content = "Final Signed Contract Version 2";

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          fileName: "Client_Contract.txt",
          fileData: Buffer.from(v1Content).toString("base64"),
          category: "CONTRACT",
        });
      versionedFileId = res.body.data.file.fileId;
    });

    it("should upload a new version and archive the previous version", async () => {
      const res = await request(app)
        .post(`/api/files/${versionedFileId}/versions`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          buffer: Buffer.from(v2Content).toString("base64"),
          fileName: "Client_Contract.txt",
          note: "Signed by client on Sept 2",
        });

      expect(res.status).toBe(201);
      const file = res.body.data.file;
      expect(file.version).toBe(2);
      expect(file.versions.length).toBe(1);
      expect(file.versions[0].version).toBe(1);
      expect(file.versions[0].note).toBe("Signed by client on Sept 2");

      // Verify downloading returns the new version
      const dlRes = await request(app)
        .get(`/api/files/${versionedFileId}/download`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(dlRes.status).toBe(200);
      expect((dlRes.text || dlRes.body).toString()).toBe(v2Content);
    });

    it("should retrieve version history", async () => {
      const res = await request(app)
        .get(`/api/files/${versionedFileId}/versions`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.currentVersion).toBe(2);
      expect(res.body.data.versions.length).toBe(1);
    });
  });

  describe("7. Soft Delete & Restore", () => {
    let fileToDeleteId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          fileName: "Obsolete_Note.txt",
          fileData: Buffer.from("obsolete content").toString("base64"),
          category: "OTHER",
        });
      fileToDeleteId = res.body.data.file.fileId;
    });

    it("should soft delete file", async () => {
      const res = await request(app)
        .delete(`/api/files/${fileToDeleteId}`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.file.status).toBe("DELETED");

      // File should not appear in active files list
      const listRes = await request(app)
        .get("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(listRes.body.data.items.some((f: any) => f.fileId === fileToDeleteId)).toBe(false);
    });

    it("should restore soft deleted file", async () => {
      const res = await request(app)
        .post(`/api/files/${fileToDeleteId}/restore`)
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.file.status).toBe("ACTIVE");

      // File should now appear in active files list
      const listRes = await request(app)
        .get("/api/files")
        .set("Authorization", `Bearer ${adminAToken}`);

      expect(listRes.body.data.items.some((f: any) => f.fileId === fileToDeleteId)).toBe(true);
    });
  });

  describe("8. Immutable Audit Trail", () => {
    it("should have recorded audit log entries for file operations", async () => {
      const logs = await AuditLog.find({
        organizationId: orgAId,
        action: { $in: ["FILE_UPLOADED", "FILE_DOWNLOADED", "FILE_DELETED", "FILE_VERSION_CREATED"] },
      }).lean();

      expect(logs.length).toBeGreaterThanOrEqual(4);
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("FILE_UPLOADED");
      expect(actions).toContain("FILE_DOWNLOADED");
      expect(actions).toContain("FILE_DELETED");
      expect(actions).toContain("FILE_VERSION_CREATED");
    });
  });
});
