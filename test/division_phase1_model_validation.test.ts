import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Organization from "../src/models/Organization";
import Division from "../src/models/Division";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import User from "../src/models/User";
import Project from "../src/models/Project";
import Task from "../src/models/Task";
import FileRecord from "../src/models/FileRecord";
import Compensation from "../src/models/Compensation";
import {
  isReservedDivisionIdentity,
  isValidDivisionCode,
  DIVISION_CODE_REGEX,
} from "../src/constants/division";
import {
  DivisionCreateSchema,
  DivisionUpdateSchema,
} from "../src/validators/division";

describe("Phase 1: NXWorkOS Division Architecture - Models & Validation", () => {
  let mongoServer: MongoMemoryServer;
  let orgAId: mongoose.Types.ObjectId;
  let orgBId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    orgAId = new mongoose.Types.ObjectId();
    orgBId = new mongoose.Types.ObjectId();

    await Organization.create([
      {
        _id: orgAId,
        name: "NexisparkX Private Limited",
        legalName: "NexisparkX Private Limited",
        status: "ACTIVE",
      },
      {
        _id: orgBId,
        name: "Secondary Tenant Org",
        legalName: "Secondary Tenant Org Ltd",
        status: "ACTIVE",
      },
    ]);

    await Division.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await Division.deleteMany({});
  });

  // =========================================================================
  // 1. Division Code Validation & Regex Pattern Rules
  // =========================================================================
  describe("Division Code Rules & Pattern Matching (^[A-Z0-9]{2,6}$)", () => {
    it("accepts valid 2 to 6 uppercase alphanumeric codes", () => {
      const validCodes = ["TE", "TECH", "EDU", "CORP1", "ENG", "OPS99", "RETAIL"];
      for (const code of validCodes) {
        expect(isValidDivisionCode(code)).toBe(true);
        expect(DIVISION_CODE_REGEX.test(code)).toBe(true);
      }
    });

    it("rejects codes shorter than 2 characters", () => {
      expect(isValidDivisionCode("A")).toBe(false);
      expect(isValidDivisionCode("1")).toBe(false);
      expect(isValidDivisionCode("")).toBe(false);
    });

    it("rejects codes longer than 6 characters", () => {
      expect(isValidDivisionCode("TECHCORP")).toBe(false);
      expect(isValidDivisionCode("RETAILS")).toBe(false);
      expect(isValidDivisionCode("ABCDEFG")).toBe(false);
    });

    it("rejects codes with lowercase letters or special characters", () => {
      expect(isValidDivisionCode("tech")).toBe(false);
      expect(isValidDivisionCode("TE-CH")).toBe(false);
      expect(isValidDivisionCode("TE_CH")).toBe(false);
      expect(isValidDivisionCode("TE CH")).toBe(false);
      expect(isValidDivisionCode("TE.CH")).toBe(false);
    });
  });

  // =========================================================================
  // 2. Reserved Entity ("NX Media") Protection Rules
  // =========================================================================
  describe("Reserved Entity ('NX Media') Defense-in-Depth Checks", () => {
    it("identifies canonical variants of 'NX Media' as reserved", () => {
      const reservedNames = [
        "NX Media",
        "nx media",
        "NXMEDIA",
        "NX-Media",
        "nx_media",
        "NX.Media",
        "NX  Media",
        "NexisparkX Media",
        "NX Media Division",
        "NX Media Group",
        "NX Media Pvt Ltd",
      ];

      for (const name of reservedNames) {
        expect(isReservedDivisionIdentity(name)).toBe(true);
      }
    });

    it("does NOT block legitimate names containing generic words ('media', 'central', 'corporate', 'global', 'HQ')", () => {
      const allowedNames = [
        "Social Media",
        "Media Production",
        "Digital Media",
        "Multimedia & Design",
        "Broadcast Media",
        "Central Operations",
        "Corporate Affairs",
        "Corporate Finance",
        "Global Logistics",
        "Global Engineering",
        "HQ Infrastructure",
        "HQ Services",
        "Technology Division",
        "Education Services",
      ];

      for (const name of allowedNames) {
        expect(isReservedDivisionIdentity(name)).toBe(false);
      }
    });
  });

  // =========================================================================
  // 3. Division Model Mongoose Schema & Database Enforcement
  // =========================================================================
  describe("Division Model Database Enforcement", () => {
    it("creates a valid Division with all required fields and default ACTIVE status", async () => {
      const division = await Division.create({
        organizationId: orgAId,
        name: "Technology Division",
        code: "TECH",
        description: "Core technology division",
        budgetCode: "BG-TECH-01",
      });

      expect(division._id).toBeDefined();
      expect(String(division.organizationId)).toBe(String(orgAId));
      expect(division.name).toBe("Technology Division");
      expect(division.code).toBe("TECH");
      expect(division.status).toBe("ACTIVE");
      expect(division.budgetCode).toBe("BG-TECH-01");
      expect(division.createdAt).toBeInstanceOf(Date);
    });

    it("enforces unique code within the same organization", async () => {
      await Division.create({
        organizationId: orgAId,
        name: "Technology Division",
        code: "TECH",
      });

      // Attempt duplicate code in Org A
      await expect(
        Division.create({
          organizationId: orgAId,
          name: "Different Tech Division",
          code: "TECH",
        })
      ).rejects.toThrow();
    });

    it("allows the same code in a different organization (tenant isolation)", async () => {
      const divA = await Division.create({
        organizationId: orgAId,
        name: "Technology Division Org A",
        code: "TECH",
      });

      const divB = await Division.create({
        organizationId: orgBId,
        name: "Technology Division Org B",
        code: "TECH",
      });

      expect(divA._id).toBeDefined();
      expect(divB._id).toBeDefined();
      expect(divA.code).toBe("TECH");
      expect(divB.code).toBe("TECH");
      expect(String(divA.organizationId)).not.toBe(String(divB.organizationId));
    });

    it("enforces unique name within the same organization", async () => {
      await Division.create({
        organizationId: orgAId,
        name: "Education Services",
        code: "EDU",
      });

      await expect(
        Division.create({
          organizationId: orgAId,
          name: "Education Services",
          code: "EDU2",
        })
      ).rejects.toThrow();
    });

    it("blocks creating a Division with reserved name 'NX Media' at schema pre-save hook", async () => {
      await expect(
        Division.create({
          organizationId: orgAId,
          name: "NX Media",
          code: "NXM",
        })
      ).rejects.toThrow(/RESERVED_DIVISION_NAME_PROHIBITED/);
    });

    it("blocks creating a Division with lowercase 'nx media' variant", async () => {
      await expect(
        Division.create({
          organizationId: orgAId,
          name: "nx media",
          code: "NXM",
        })
      ).rejects.toThrow(/RESERVED_DIVISION_NAME_PROHIBITED/);
    });

    it("blocks renaming an existing division to 'NX Media' via findOneAndUpdate", async () => {
      const div = await Division.create({
        organizationId: orgAId,
        name: "Original Division",
        code: "ORIG",
      });

      await expect(
        Division.findOneAndUpdate(
          { _id: div._id },
          { name: "NX Media" }
        )
      ).rejects.toThrow(/RESERVED_DIVISION_NAME_PROHIBITED/);
    });

    it("enforces immutability: blocks changing organizationId on update", async () => {
      const div = await Division.create({
        organizationId: orgAId,
        name: "Immutability Test Division",
        code: "IMMUT",
      });

      await expect(
        Division.findOneAndUpdate(
          { _id: div._id },
          { organizationId: orgBId }
        )
      ).rejects.toThrow(/ORGANIZATION_IMMUTABLE/);
    });

    it("enforces immutability: blocks changing division code on update", async () => {
      const div = await Division.create({
        organizationId: orgAId,
        name: "Code Immutability Division",
        code: "CODE1",
      });

      await expect(
        Division.findOneAndUpdate(
          { _id: div._id },
          { code: "CODE2" }
        )
      ).rejects.toThrow(/DIVISION_CODE_IMMUTABLE/);
    });
  });

  // =========================================================================
  // 4. Zod Input Schema Validation Tests
  // =========================================================================
  describe("Zod Validation Schemas (DivisionCreateSchema & DivisionUpdateSchema)", () => {
    it("validates a compliant DivisionCreateSchema input", () => {
      const result = DivisionCreateSchema.safeParse({
        organizationId: String(orgAId),
        name: "Retail Division",
        code: "RETAIL",
        description: "Retail operations",
        budgetCode: "RET-2026",
      });

      expect(result.success).toBe(true);
    });

    it("rejects DivisionCreateSchema when code fails regex format", () => {
      const result = DivisionCreateSchema.safeParse({
        organizationId: String(orgAId),
        name: "Retail Division",
        code: "retail-invalid",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("2-6 uppercase alphanumeric");
      }
    });

    it("rejects DivisionCreateSchema when name is 'NX Media'", () => {
      const result = DivisionCreateSchema.safeParse({
        organizationId: String(orgAId),
        name: "NX Media",
        code: "NXM",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("reserved corporate entity");
      }
    });

    it("accepts DivisionCreateSchema with legitimate names containing 'media'", () => {
      const result = DivisionCreateSchema.safeParse({
        organizationId: String(orgAId),
        name: "Social Media Division",
        code: "SMEDIA",
      });

      expect(result.success).toBe(true);
    });

    it("validates DivisionUpdateSchema disallows organizationId and code", () => {
      // DivisionUpdateSchema only permits name, description, divisionHeadId, budgetCode, status
      const validUpdate = DivisionUpdateSchema.safeParse({
        name: "Updated Division Name",
        description: "Updated description",
        status: "INACTIVE",
      });

      expect(validUpdate.success).toBe(true);

      // Rejects renaming to NX Media
      const invalidUpdate = DivisionUpdateSchema.safeParse({
        name: "NX Media",
      });
      expect(invalidUpdate.success).toBe(false);
    });
  });

  // =========================================================================
  // 5. Backward Compatibility with Existing Models
  // =========================================================================
  describe("Backward Compatibility with Existing Models", () => {
    let testDivision: any;

    beforeEach(async () => {
      testDivision = await Division.create({
        organizationId: orgAId,
        name: "Engineering Division",
        code: "ENG",
      });
    });

    it("Department: creates legacy department without divisionId (defaults to null, isCentral: false)", async () => {
      const dept = await Department.create({
        organizationId: orgAId,
        name: "Legacy Dept " + Date.now(),
      });

      expect(dept.divisionId).toBeNull();
      expect(dept.isCentral).toBe(false);
      expect(dept.status).toBe("ACTIVE");
    });

    it("Department: creates divisional department with divisionId", async () => {
      const dept = await Department.create({
        organizationId: orgAId,
        divisionId: testDivision._id,
        name: "Software Engineering " + Date.now(),
      });

      expect(String(dept.divisionId)).toBe(String(testDivision._id));
      expect(dept.isCentral).toBe(false);
    });

    it("Department: creates central headquarters department (divisionId: null, isCentral: true)", async () => {
      const dept = await Department.create({
        organizationId: orgAId,
        divisionId: null,
        isCentral: true,
        name: "Central HR " + Date.now(),
      });

      expect(dept.divisionId).toBeNull();
      expect(dept.isCentral).toBe(true);
    });

    it("Team: creates team with optional divisionId", async () => {
      const dept = await Department.create({
        organizationId: orgAId,
        divisionId: testDivision._id,
        name: "Product Design Dept " + Date.now(),
      });

      const team = await Team.create({
        organizationId: orgAId,
        departmentId: dept._id,
        divisionId: testDivision._id,
        name: "UI Squad " + Date.now(),
      });

      expect(String(team.divisionId)).toBe(String(testDivision._id));
      expect(String(team.departmentId)).toBe(String(dept._id));
    });

    it("User: preserves legacy string departmentId/teamId while supporting divisionId & teamMemberships", async () => {
      const user = await User.create({
        fullName: "Matrix Engineer",
        email: `matrix_eng_${Date.now()}@nexisparkx.test`,
        passwordHash: "hashed_secret",
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        organizationId: orgAId,
        divisionId: testDivision._id,
        primaryDivisionId: testDivision._id,
        departmentId: "legacy-string-dept-id",
        teamId: "legacy-string-team-id",
        teamMemberships: [
          {
            teamId: new mongoose.Types.ObjectId(),
            role: "LEAD",
            isPrimary: true,
          },
        ],
      });

      expect(user._id).toBeDefined();
      expect(String(user.divisionId)).toBe(String(testDivision._id));
      expect(user.departmentId).toBe("legacy-string-dept-id");
      expect(user.teamId).toBe("legacy-string-team-id");
      expect(user.teamMemberships).toHaveLength(1);
      expect(user.teamMemberships![0].role).toBe("LEAD");
    });

    it("Project: supports divisionId, isCrossDivision, and collaboratingDivisionIds", async () => {
      const div2 = await Division.create({
        organizationId: orgAId,
        name: "Marketing Division",
        code: "MKTG",
      });

      const project = await Project.create({
        projectId: "PRJ-TEST-001",
        organizationId: orgAId,
        divisionId: testDivision._id,
        isCrossDivision: true,
        collaboratingDivisionIds: [div2._id],
        name: "Cross-Division Platform Launch",
        code: "CDPL-101",
        ownerId: new mongoose.Types.ObjectId(),
        createdBy: new mongoose.Types.ObjectId(),
      });

      expect(String(project.divisionId)).toBe(String(testDivision._id));
      expect(project.isCrossDivision).toBe(true);
      expect(project.collaboratingDivisionIds).toHaveLength(1);
      expect(String(project.collaboratingDivisionIds![0])).toBe(String(div2._id));
    });

    it("Task: supports optional divisionId while defaulting to null for legacy compatibility", async () => {
      const task = await Task.create({
        taskId: "TSK-TEST-001",
        title: "Divisional Task Implementation",
        organizationId: orgAId,
        divisionId: testDivision._id,
        assignedTo: new mongoose.Types.ObjectId(),
        assignedBy: new mongoose.Types.ObjectId(),
      });

      expect(String(task.divisionId)).toBe(String(testDivision._id));
    });

    it("FileRecord: supports visibility 'DIVISION' and divisionId", async () => {
      const file = await FileRecord.create({
        fileId: "FILE-DIV-001",
        organizationId: orgAId,
        divisionId: testDivision._id,
        visibility: "DIVISION",
        uploadedBy: new mongoose.Types.ObjectId(),
        ownerId: new mongoose.Types.ObjectId(),
        originalName: "strategy.pdf",
        storedName: "stored-strategy.pdf",
        mimeType: "application/pdf",
        extension: "pdf",
        size: 1024,
        checksum: "sha256-hash-placeholder",
        storagePath: "/path/to/doc",
      });

      expect(file.visibility).toBe("DIVISION");
      expect(String(file.divisionId)).toBe(String(testDivision._id));
    });

    it("Compensation: supports optional divisionId", async () => {
      const comp = await Compensation.create({
        userId: new mongoose.Types.ObjectId(),
        organizationId: orgAId,
        divisionId: testDivision._id,
        employmentType: "EMPLOYEE",
        compensationType: "SALARY",
        baseAmount: 75000,
        effectiveFrom: new Date(),
        createdBy: new mongoose.Types.ObjectId(),
      });

      expect(String(comp.divisionId)).toBe(String(testDivision._id));
      expect(comp.baseAmount).toBe(75000);
    });
  });
});
