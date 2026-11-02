import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app";
import { env } from "../src/config/env";
import Organization from "../src/models/Organization";
import Division from "../src/models/Division";
import User from "../src/models/User";
import NXDocument from "../src/models/NXDocument";
import AuditLog from "../src/models/AuditLog";
import * as docIdService from "../src/services/documentIdService";
import * as docService from "../src/services/documentManagementService";
import {
  OFFICIAL_COMPANY_CIN,
  OFFICIAL_SYSTEM_PREFIX,
  DOCUMENT_TYPE_REGISTRY,
  getAllDocumentTypes,
} from "../src/constants/documentTypeCodes";

describe("Official NexisparkX Document ID Generation & Storage System", () => {
  let mongoServer: MongoMemoryServer;
  let testOrg: any;
  let foreignOrg: any;
  let activeDivision: any;
  let superAdminUser: any;
  let adminUser: any;
  let divisionAdminUser: any;
  let regularEmployeeUser: any;
  let foreignAdminUser: any;

  let superAdminToken: string;
  let adminToken: string;
  let divisionAdminToken: string;
  let employeeToken: string;
  let foreignAdminToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // 1. Create Organization with official NexisparkX CIN
    testOrg = await Organization.create({
      name: "NexisparkX Private Limited",
      legalName: "NEXISPARKX PRIVATE LIMITED",
      cin: OFFICIAL_COMPANY_CIN,
      companyPrefix: "N",
      email: "governance@nexisparkx.com",
      status: "ACTIVE",
    });

    foreignOrg = await Organization.create({
      name: "External Foreign Corp",
      legalName: "EXTERNAL FOREIGN CORP LTD",
      cin: "U99999MH2025PTC111111",
      companyPrefix: "N",
      email: "contact@foreigncorp.com",
      status: "ACTIVE",
    });

    // 2. Create Division
    activeDivision = await Division.create({
      name: "Product & Technology Division",
      code: "TECH01",
      organizationId: testOrg._id,
      status: "ACTIVE",
    });

    // 3. Create Users
    superAdminUser = await User.create({
      fullName: "Super Administrator",
      email: "superadmin_doc@nexisparkx.com",
      passwordHash: "hash123",
      role: "SUPER_ADMIN",
      employmentType: "EMPLOYEE",
      employeeId: "SA-DOC-01",
      organizationId: testOrg._id,
      status: "ACTIVE",
    });

    adminUser = await User.create({
      fullName: "Org Admin",
      email: "admin_doc@nexisparkx.com",
      passwordHash: "hash123",
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      employeeId: "ADM-DOC-01",
      organizationId: testOrg._id,
      status: "ACTIVE",
    });

    divisionAdminUser = await User.create({
      fullName: "Division Admin",
      email: "divadmin_doc@nexisparkx.com",
      passwordHash: "hash123",
      role: "DIVISION_ADMIN",
      employmentType: "EMPLOYEE",
      employeeId: "DIV-DOC-01",
      organizationId: testOrg._id,
      divisionId: activeDivision._id,
      status: "ACTIVE",
    });

    regularEmployeeUser = await User.create({
      fullName: "Standard Employee",
      email: "employee_doc@nexisparkx.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      employeeId: "EMP-DOC-01",
      organizationId: testOrg._id,
      divisionId: activeDivision._id,
      status: "ACTIVE",
      permissions: [],
    });

    foreignAdminUser = await User.create({
      fullName: "Foreign Tenant Admin",
      email: "admin@foreigncorp.com",
      passwordHash: "hash123",
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      employeeId: "FOR-ADM-01",
      organizationId: foreignOrg._id,
      status: "ACTIVE",
    });

    const jwtSecret = env.JWT_SECRET || "test-jwt-secret";
    const sign = (u: any) =>
      jwt.sign(
        {
          sub: u._id.toString(),
          userId: u._id.toString(),
          id: u._id.toString(),
          email: u.email,
          role: u.role,
          organizationId: u.organizationId.toString(),
          divisionId: u.divisionId?.toString() || null,
        },
        jwtSecret,
        { expiresIn: "1h" }
      );

    superAdminToken = sign(superAdminUser);
    adminToken = sign(adminUser);
    divisionAdminToken = sign(divisionAdminUser);
    employeeToken = sign(regularEmployeeUser);
    foreignAdminToken = sign(foreignAdminUser);

    // Seed catalog
    await docService.ensurePredefinedDocumentCatalog(String(testOrg._id));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe("1. Official Document ID Structure & Components", () => {
    it("1. Includes the exact CIN unchanged: U62099MP2026PTC084748", async () => {
      const docId = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "CONTRACT", // code 847
      });

      expect(docId).toContain("U62099MP2026PTC084748");
      expect(OFFICIAL_COMPANY_CIN).toBe("U62099MP2026PTC084748");
    });

    it("2. Generated ID begins exactly with: N + U62099MP2026PTC084748", async () => {
      const docId = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "PROPOSAL", // code 592
      });

      expect(docId.startsWith("NU62099MP2026PTC084748")).toBe(true);
    });

    it("3. Year (YY) is automatically generated from server time", async () => {
      const customDate = new Date("2028-06-15T12:00:00Z");
      const docId = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "OFFER_LETTER",
        docDate: customDate,
      });

      const parsed = docIdService.validateDocumentId(docId);
      expect(parsed.isValid).toBe(true);
      expect(parsed.parsed?.year).toBe("28");
    });

    it("4. Month (MM) is always exactly two digits", async () => {
      const januaryDate = new Date("2026-01-05T10:00:00Z");
      const docIdJan = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "APPOINTMENT_LETTER",
        docDate: januaryDate,
      });

      const parsedJan = docIdService.validateDocumentId(docIdJan);
      expect(parsedJan.parsed?.month).toBe("01");

      const novemberDate = new Date("2026-11-20T10:00:00Z");
      const docIdNov = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "APPOINTMENT_LETTER",
        docDate: novemberDate,
      });

      const parsedNov = docIdService.validateDocumentId(docIdNov);
      expect(parsedNov.parsed?.month).toBe("11");
    });

    it("5. Day (DD) is always exactly two digits", async () => {
      const secondDay = new Date("2026-11-02T10:00:00Z");
      const docId = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "CONTRACT",
        docDate: secondDay,
      });

      const parsed = docIdService.validateDocumentId(docId);
      expect(parsed.parsed?.day).toBe("02");
    });

    it("6. Random reference (RRR) is exactly three numeric digits", async () => {
      for (let i = 0; i < 10; i++) {
        const rrr = docIdService.generateRandomReference();
        expect(rrr.length).toBe(3);
        expect(/^\d{3}$/.test(rrr)).toBe(true);
      }
    });

    it("7. Document type code (TTT) is exactly three numeric digits", async () => {
      const code = docIdService.getDocumentTypeCode("CONTRACT");
      expect(code.length).toBe(3);
      expect(/^\d{3}$/.test(code)).toBe(true);
      expect(code).toBe("847");
    });

    it("8. Document type code contains no zero in any position", async () => {
      const allTypes = getAllDocumentTypes();
      expect(allTypes.length).toBeGreaterThanOrEqual(35);

      for (const entry of allTypes) {
        expect(entry.code.includes("0")).toBe(false);
        expect(/^[1-9]{3}$/.test(entry.code)).toBe(true);
      }

      // Rejects any code with zero
      expect(() => docIdService.getDocumentTypeCode("052")).toThrow(/zero/i);
      expect(() => docIdService.getDocumentTypeCode("502")).toThrow(/zero/i);
      expect(() => docIdService.getDocumentTypeCode("520")).toThrow(/zero/i);
    });

    it("9. IDs contain no dashes, underscores, spaces, or slashes", async () => {
      const docId = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "OFFER_LETTER",
      });

      expect(docId.includes("-")).toBe(false);
      expect(docId.includes("_")).toBe(false);
      expect(docId.includes(" ")).toBe(false);
      expect(docId.includes("/")).toBe(false);
      expect(docId.length).toBe(34);
    });

    it("10. Different document types receive different registered type codes", () => {
      const contractCode = docIdService.getDocumentTypeCode("CONTRACT");
      const proposalCode = docIdService.getDocumentTypeCode("PROPOSAL");
      const offerLetterCode = docIdService.getDocumentTypeCode("OFFER_LETTER");

      expect(contractCode).toBe("847");
      expect(proposalCode).toBe("592");
      expect(offerLetterCode).toBe("731");
      expect(contractCode).not.toBe(proposalCode);
      expect(proposalCode).not.toBe(offerLetterCode);
    });
  });

  describe("2. Uniqueness, Collision Safety & Database Integrity", () => {
    it("11. Generated IDs are unique across multiple rapid invocations", async () => {
      const generated = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const id = await docIdService.generateDocumentId({
          organizationId: testOrg._id,
          documentType: "EXPERIENCE_LETTER",
        });
        generated.add(id);
      }
      expect(generated.size).toBe(30);
    });

    it("12. Collision handling regenerates safely when a candidate ID already exists", async () => {
      // Create a document with a predetermined ID
      const fixedDocId = "NU62099MP2026PTC084748261102999847";
      await NXDocument.create({
        documentId: fixedDocId,
        organizationId: testOrg._id,
        title: "Collision Seed Document",
        categoryId: new mongoose.Types.ObjectId(),
        documentTypeId: new mongoose.Types.ObjectId(),
        documentTypeCode: "847",
        status: "ACTIVE",
        isLegacyImport: false,
        createdBy: adminUser._id,
      });

      // Verification that checkDocumentIdUniqueness detects it
      const isUnique = await docIdService.checkDocumentIdUniqueness(fixedDocId);
      expect(isUnique).toBe(false);

      // Generating a new document will never return the colliding fixedDocId
      const newDocId = await docIdService.generateDocumentId({
        organizationId: testOrg._id,
        documentType: "847",
        docDate: new Date("2026-11-02"),
      });

      expect(newDocId).not.toBe(fixedDocId);
      expect(await docIdService.checkDocumentIdUniqueness(newDocId)).toBe(true);
    });

    it("13. Database unique index prevents duplicate IDs at persistence level", async () => {
      const duplicateId = "NU62099MP2026PTC084748261102111847";

      await NXDocument.create({
        documentId: duplicateId,
        organizationId: testOrg._id,
        title: "Original Document",
        categoryId: new mongoose.Types.ObjectId(),
        documentTypeId: new mongoose.Types.ObjectId(),
        documentTypeCode: "847",
        status: "ACTIVE",
        isLegacyImport: false,
        createdBy: adminUser._id,
      });

      await expect(
        NXDocument.create({
          documentId: duplicateId,
          organizationId: testOrg._id,
          title: "Duplicate Document Attempt",
          categoryId: new mongoose.Types.ObjectId(),
          documentTypeId: new mongoose.Types.ObjectId(),
          documentTypeCode: "847",
          status: "ACTIVE",
          isLegacyImport: false,
          createdBy: adminUser._id,
        })
      ).rejects.toThrow();
    });
  });

  describe("3. Authorization, Scoping & Immutability", () => {
    it("14. Client cannot override the official CIN to arbitrary values", async () => {
      const res = await request(app)
        .post("/api/document-management/documents")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Malicious CIN Override Attempt",
          documentType: "CONTRACT",
          cin: "U11111XX2026PTC000000", // Fake CIN override
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/CLIENT_OVERRIDE_PROHIBITED/i);
    });

    it("15. Client cannot override the document type code to invalid values with zero", async () => {
      const res = await request(app)
        .post("/api/document-management/documents")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Invalid Type Code with Zero Attempt",
          typeCode: "502", // Contains zero
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/INVALID_DOCUMENT_TYPE/i);
    });

    it("16. Client cannot choose an arbitrary official document ID", async () => {
      const res = await request(app)
        .post("/api/document-management/documents")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Arbitrary ID Attempt",
          documentType: "CONTRACT",
          documentId: "NU62099MP2026PTC084748261102777847", // Client specified ID
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/CLIENT_OVERRIDE_PROHIBITED/i);
    });

    it("17. Historical documents are not modified or regenerated", async () => {
      // Historical document with legacy format
      const historical = await NXDocument.create({
        documentId: "LEGACY-REF-2023-XYZ-999",
        organizationId: testOrg._id,
        title: "Historical Paper Contract 2023",
        categoryId: new mongoose.Types.ObjectId(),
        documentTypeId: new mongoose.Types.ObjectId(),
        documentTypeCode: "847",
        status: "ACTIVE",
        isLegacyImport: true,
        legacyReferenceId: "OLD-DOC-2023",
        createdBy: adminUser._id,
      });

      const fetched = await docService.getDocumentById(adminUser, historical._id);
      expect(fetched.documentId).toBe("LEGACY-REF-2023-XYZ-999");
      expect(fetched.isLegacyImport).toBe(true);
    });

    it("18. Generated document IDs are immutable even on title or metadata updates", async () => {
      const doc = await docService.createDocument(adminUser, {
        title: "Original Immutable Contract",
        documentType: "CONTRACT",
      });

      const originalId = doc.documentId;
      expect(originalId.startsWith("NU62099MP2026PTC084748")).toBe(true);

      // Attempt to modify documentId via updateDocumentMetadata
      await expect(
        docService.updateDocumentMetadata(adminUser, doc._id, {
          documentId: "MODIFIED-ID-99999",
        })
      ).rejects.toThrow(/IMMUTABLE_DOCUMENT_ID/i);

      // Legitimate title and description update
      const updated = await docService.updateDocumentMetadata(adminUser, doc._id, {
        title: "Updated Contract Title",
        shortDescription: "Revised description text",
      });

      expect(updated.documentId).toBe(originalId);
      expect(updated.title).toBe("Updated Contract Title");
    });

    it("19. Cross-tenant document creation/access is strictly denied", async () => {
      // Admin from Foreign Org tries to access Test Org's document
      const doc = await docService.createDocument(adminUser, {
        title: "Test Org Confidential Strategy",
        documentType: "CONTRACT",
      });

      await expect(docService.getDocumentById(foreignAdminUser, doc._id)).rejects.toThrow(/DOCUMENT_NOT_FOUND/i);
    });

    it("20. Division administrators cannot access central or cross-division records automatically", async () => {
      // Central document (divisionId: null)
      const centralDoc = await docService.createDocument(adminUser, {
        title: "Headquarters Corporate Policy",
        documentType: "POLICY_DOCUMENT",
        divisionId: null,
      });

      // Division Admin attempting to access central document
      await expect(docService.getDocumentById(divisionAdminUser, centralDoc._id)).rejects.toThrow(
        /Division administrators cannot access central or cross-division documents/i
      );
    });

    it("21. Unauthorized users (regular employees without permissions) cannot create documents", async () => {
      await expect(
        docService.createDocument(regularEmployeeUser, {
          title: "Unauthorized Document Attempt",
          documentType: "CONTRACT",
        })
      ).rejects.toThrow(/FORBIDDEN: You do not have permission to create official documents/i);
    });

    it("22. Audit logging records document lifecycle events safely", async () => {
      const doc = await docService.createDocument(adminUser, {
        title: "Audit Verified Contract",
        documentType: "CONTRACT",
      });

      // Check audit log for DOCUMENT_CREATED
      const createLog = await AuditLog.findOne({
        action: "DOCUMENT_CREATED",
        entityId: doc._id,
      });

      expect(createLog).not.toBeNull();
      expect(createLog?.actorRole).toBe("ADMIN");
      expect(createLog?.summary).toContain(doc.documentId);
      expect(createLog?.metadata).toHaveProperty("documentId", doc.documentId);

      // Update metadata
      await docService.updateDocumentMetadata(adminUser, doc._id, {
        shortDescription: "Added note for audit verification",
      });

      const updateLog = await AuditLog.findOne({
        action: "DOCUMENT_UPDATED",
        entityId: doc._id,
      });
      expect(updateLog).not.toBeNull();

      // Archive document
      await docService.archiveDocument(adminUser, doc._id, "Compliance retirement");

      const archiveLog = await AuditLog.findOne({
        action: "DOCUMENT_ARCHIVED",
        entityId: doc._id,
      });
      expect(archiveLog).not.toBeNull();
      expect(archiveLog?.summary).toContain("Archived");
    });
  });
});
