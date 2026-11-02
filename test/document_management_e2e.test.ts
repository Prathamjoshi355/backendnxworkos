import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Organization from "../src/models/Organization";
import User from "../src/models/User";
import DocumentCategory from "../src/models/DocumentCategory";
import DocumentType from "../src/models/DocumentType";
import DocumentAllocationControl from "../src/models/DocumentAllocationControl";
import ClientCompany from "../src/models/ClientCompany";
import NXDocument from "../src/models/NXDocument";
import * as docService from "../src/services/documentManagementService";
import * as adminService from "../src/services/superAdminControlService";

describe("NXWorkOS: Centralized Document Management Module End-to-End Tests", () => {
  let mongoServer: MongoMemoryServer;

  let testOrg: any;
  let otherOrg: any;
  let superAdminUser: any;
  let adminUser: any;
  let employeeUser: any;
  let otherOrgUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // 1. Create Organization with CIN and Prefix
    testOrg = await Organization.create({
      name: "NexisparkX Private Limited",
      legalName: "NexisparkX Private Limited",
      slug: "nexisparkx",
      status: "ACTIVE",
      cin: "U72900KA2026PTC189000",
      companyPrefix: "N",
      gstNumber: "29ABCDE1234F1Z5",
      panNumber: "ABCDE1234F",
    });

    otherOrg = await Organization.create({
      name: "Other Tenant Corp",
      legalName: "Other Tenant Corp",
      slug: "other-tenant",
      status: "ACTIVE",
      cin: "U88888DL2026PTC999999",
      companyPrefix: "N",
    });

    // 2. Create Users
    superAdminUser = await User.create({
      fullName: "Global Super Admin",
      email: "superadmin@nexisparkx.com",
      role: "SUPER_ADMIN",
      organizationId: testOrg._id,
      passwordHash: "hash123",
      employeeId: "EMP-001",
    });

    adminUser = await User.create({
      fullName: "Org Admin",
      email: "admin@nexisparkx.com",
      role: "ADMIN",
      organizationId: testOrg._id,
      passwordHash: "hash123",
      employeeId: "EMP-002",
    });

    employeeUser = await User.create({
      fullName: "Jane Employee",
      email: "jane@nexisparkx.com",
      role: "EMPLOYEE",
      organizationId: testOrg._id,
      passwordHash: "hash123",
      employeeId: "EMP-003",
    });

    otherOrgUser = await User.create({
      fullName: "Foreign Tenant User",
      email: "foreign@other.com",
      role: "ADMIN",
      organizationId: otherOrg._id,
      passwordHash: "hash123",
      employeeId: "EMP-999",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("1. Document Catalogue & Strict 3-Digit Type Codes (Zero Strictly Prohibited)", () => {
    it("should seed default categories and predefined types correctly", async () => {
      await docService.ensureDocumentCatalogue(String(testOrg._id));

      const categories = await DocumentCategory.find({ organizationId: testOrg._id });
      expect(categories.length).toBeGreaterThanOrEqual(11);

      const types = await DocumentType.find({ status: "ACTIVE" });
      expect(types.length).toBeGreaterThanOrEqual(20);

      // Verify each predefined code matches strict rule: exactly 3 digits, each 1-9 (NO ZERO)
      const zeroForbiddenRegex = /^[1-9]{3}$/;
      for (const t of types) {
        expect(t.code).toMatch(zeroForbiddenRegex);
        expect(t.code.includes("0")).toBe(false);
      }
    });

    it("should accept valid 3-digit code with digits 1-9", async () => {
      const typeDoc = await docService.registerDocumentType(superAdminUser, {
        code: "948",
        name: "Custom Non-Disclosure Addendum",
        categoryCode: "LEGAL_COMP",
        description: "Special NDA Addendum",
      });

      expect(typeDoc.code).toBe("948");
      expect(typeDoc.name).toBe("Custom Non-Disclosure Addendum");
    });

    it("should strictly reject codes containing ZERO in any position", async () => {
      // 0 in first position
      await expect(
        docService.registerDocumentType(superAdminUser, {
          code: "012",
          name: "Invalid Zero First",
          categoryCode: "HR_EMP",
        })
      ).rejects.toThrow(/zero is strictly prohibited/i);

      // 0 in second position
      await expect(
        docService.registerDocumentType(superAdminUser, {
          code: "502",
          name: "Invalid Zero Middle",
          categoryCode: "HR_EMP",
        })
      ).rejects.toThrow(/zero is strictly prohibited/i);

      // 0 in third position
      await expect(
        docService.registerDocumentType(superAdminUser, {
          code: "510",
          name: "Invalid Zero Last",
          categoryCode: "HR_EMP",
        })
      ).rejects.toThrow(/zero is strictly prohibited/i);
    });

    it("should strictly reject codes not exactly 3 digits", async () => {
      // 2 digits
      await expect(
        docService.registerDocumentType(superAdminUser, {
          code: "52",
          name: "Too Short",
          categoryCode: "HR_EMP",
        })
      ).rejects.toThrow(/exactly 3 digits/i);

      // 4 digits
      await expect(
        docService.registerDocumentType(superAdminUser, {
          code: "5234",
          name: "Too Long",
          categoryCode: "HR_EMP",
        })
      ).rejects.toThrow(/exactly 3 digits/i);

      // Non-digit characters
      await expect(
        docService.registerDocumentType(superAdminUser, {
          code: "52A",
          name: "Non Numeric",
          categoryCode: "HR_EMP",
        })
      ).rejects.toThrow(/exactly 3 digits/i);
    });

    it("should strictly reject duplicate document type codes", async () => {
      await expect(
        docService.registerDocumentType(superAdminUser, {
          code: "512", // Already registered for Offer Letter
          name: "Duplicate Offer Letter",
          categoryCode: "HR_EMP",
        })
      ).rejects.toThrow(/DOCUMENT_TYPE_CODE_EXISTS/i);
    });
  });

  describe("2. Document ID Generation Format & Collision Resistance", () => {
    it("should generate permanent Document ID according to strict specification without separators", async () => {
      const docId = await docService.generateDocumentId(String(testOrg._id), "512");

      // Expected format: N + CIN + YYMMDD + RANDOM_ALPHANUMERIC(6) + TYPE_CODE(3)
      // e.g.: N + U72900KA2026PTC189000 + YYMMDD(6) + RANDOM(6) + 512
      expect(docId.startsWith("NU72900KA2026PTC189000")).toBe(true);
      expect(docId.endsWith("512")).toBe(true);

      // No separators anywhere
      expect(docId.includes("-")).toBe(false);
      expect(docId.includes("/")).toBe(false);
      expect(docId.includes(" ")).toBe(false);
      expect(docId.includes("_")).toBe(false);

      // Total length: 1 (prefix) + 21 (CIN) + 6 (date) + 3 (RRR numeric) + 3 (TTT type) = 34 chars
      expect(docId.length).toBe(34);
    });

    it("should generate unique IDs across multiple invocations", async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const id = await docService.generateDocumentId(String(testOrg._id), "749");
        ids.add(id);
      }
      expect(ids.size).toBe(20);
    });
  });

  describe("3. Independent Legacy Import Counter vs Live Allocation Control", () => {
    it("should increment currentLiveAllocationCounter on live registration without touching totalLegacyImports", async () => {
      const initialControl = await docService.getDocumentAllocationStatus(adminUser);
      const initialLive = initialControl.currentLiveAllocationCounter;
      const initialLegacy = initialControl.totalLegacyImports;

      const registeredDoc = await docService.registerDocument(adminUser, {
        title: "Senior Fullstack Engineer Offer Letter",
        categoryCode: "HR_EMP",
        typeCode: "512",
        recipientType: "EMPLOYEE",
        recipientName: "Alice Walker",
        recipientEmail: "alice@example.com",
        isLegacyImport: false,
      });

      expect(registeredDoc.documentId).toBeDefined();
      expect(registeredDoc.isLegacyImport).toBe(false);

      const afterControl = await docService.getDocumentAllocationStatus(adminUser);
      expect(afterControl.currentLiveAllocationCounter).toBe(initialLive + 1);
      expect(afterControl.totalLegacyImports).toBe(initialLegacy); // Unchanged!
    });

    it("should increment totalLegacyImports on legacy import without touching currentLiveAllocationCounter", async () => {
      const beforeControl = await docService.getDocumentAllocationStatus(adminUser);
      const beforeLive = beforeControl.currentLiveAllocationCounter;
      const beforeLegacy = beforeControl.totalLegacyImports;

      const legacyDoc = await docService.registerDocument(adminUser, {
        title: "Historical Service Agreement 2023",
        categoryCode: "BUS_SALES",
        typeCode: "693",
        recipientType: "CLIENT",
        recipientName: "Acme Corp",
        isLegacyImport: true,
        legacyReferenceNumber: "LEGACY-REF-2023-089",
      });

      expect(legacyDoc.isLegacyImport).toBe(true);
      expect(legacyDoc.legacyReferenceNumber).toBe("LEGACY-REF-2023-089");

      const afterControl = await docService.getDocumentAllocationStatus(adminUser);
      expect(afterControl.totalLegacyImports).toBe(beforeLegacy + 1);
      expect(afterControl.currentLiveAllocationCounter).toBe(beforeLive); // Unchanged!
    });

    it("should allow Super Admin to adjust allocations and maintain audit trail", async () => {
      const result = await docService.updateDocumentAllocation(superAdminUser, {
        maxDocumentAllocation: 10000,
        notes: "Enterprise annual plan expansion",
      });

      expect(result.maxDocumentAllocation).toBe(10000);
      expect(result.allocationHistory.length).toBeGreaterThan(0);
      const latestHistory = result.allocationHistory[result.allocationHistory.length - 1];
      expect(latestHistory.notes).toBe("Enterprise annual plan expansion");
      expect(String(latestHistory.changedBy)).toBe(String(superAdminUser._id));
    });

    it("should reject non-Super Admin from updating allocation control", async () => {
      await expect(
        docService.updateDocumentAllocation(adminUser, {
          maxDocumentAllocation: 999999,
        })
      ).rejects.toThrow(/FORBIDDEN_SUPER_ADMIN_ONLY/i);

      await expect(
        docService.updateDocumentAllocation(employeeUser, {
          maxDocumentAllocation: 999999,
        })
      ).rejects.toThrow(/FORBIDDEN_SUPER_ADMIN_ONLY/i);
    });
  });

  describe("4. Reusable Client Company Entity & Financial Documents", () => {
    let client: any;

    it("should register reusable client company with CIN and tax details", async () => {
      client = await docService.registerClientCompany(adminUser, {
        companyName: "Zenith Global Solutions Ltd",
        cin: "U74999KA2024PTC112233",
        gstin: "29AABCZ1234D1Z2",
        pan: "AABCZ1234D",
        officialEmail: "contracts@zenithglobal.com",
        contactPersonName: "Robert Vance",
        contactPersonPhone: "+919876543210",
      });

      expect(client.companyName).toBe("Zenith Global Solutions Ltd");
      expect(client.cin).toBe("U74999KA2024PTC112233");
    });

    it("should register a financial document (Invoice) linked to ClientCompany with amounts", async () => {
      const invoiceDoc = await docService.registerDocument(adminUser, {
        title: "Q4 Software Engineering Services Invoice",
        categoryCode: "FIN_ACCTS",
        typeCode: "584", // Invoice
        clientCompanyId: String(client._id),
        recipientType: "CLIENT",
        recipientName: client.companyName,
        recipientEmail: client.officialEmail,
        financialAmount: 450000,
        financialCurrency: "INR",
        financialTaxAmount: 81000,
        validityStartDate: new Date("2026-11-01"),
        validityEndDate: new Date("2026-12-01"),
      });

      expect(invoiceDoc.financialAmount).toBe(450000);
      expect(invoiceDoc.financialCurrency).toBe("INR");
      expect(String(invoiceDoc.clientCompanyId)).toBe(String(client._id));
      expect(invoiceDoc.activityHistory.length).toBeGreaterThan(0);
      expect(invoiceDoc.activityHistory[0].action).toBe("REGISTERED");
    });

    it("should enforce financial fields on invoice/PO type documents", async () => {
      await expect(
        docService.registerDocument(adminUser, {
          title: "Invoice Missing Amount",
          categoryCode: "FIN_ACCTS",
          typeCode: "584", // Invoice requires financial details
          recipientType: "CLIENT",
          recipientName: "Test Client",
        })
      ).rejects.toThrow(/Financial amount and currency are required/i);
    });
  });

  describe("5. Document Attachments, Size Limits & Signed URLs", () => {
    let testDoc: any;

    beforeAll(async () => {
      testDoc = await docService.registerDocument(adminUser, {
        title: "Non-Disclosure Agreement with Partner",
        categoryCode: "LEGAL_COMP",
        typeCode: "194", // NDA
        recipientType: "OTHER",
        recipientName: "Partner Organization",
      });
    });

    it("should upload attachment buffer and compute SHA-256 checksum", async () => {
      const fileData = Buffer.from("CONFIDENTIAL CONTRACT CLAUSES CONTENT DRAFT");
      const attachment = await docService.uploadDocumentAttachment(adminUser, String(testDoc._id), {
        buffer: fileData,
        fileName: "nda_signed_v1.pdf",
        mimeType: "application/pdf",
        attachmentType: "SIGNED_SCAN",
      });

      expect(attachment.fileName).toBe("nda_signed_v1.pdf");
      expect(attachment.checksumSha256).toBeDefined();
      expect(attachment.fileSizeBytes).toBe(fileData.length);
      expect(attachment.attachmentType).toBe("SIGNED_SCAN");

      // Verify activity history logged the attachment
      const updated = await NXDocument.findById(testDoc._id);
      const lastAction = updated?.activityHistory[updated.activityHistory.length - 1];
      expect(lastAction?.action).toBe("ATTACHMENT_ADDED");
    });

    it("should reject attachments exceeding 25MB maximum limit", async () => {
      // Create virtual oversized buffer
      const oversized = Buffer.alloc(26 * 1024 * 1024); // 26MB
      await expect(
        docService.uploadDocumentAttachment(adminUser, String(testDoc._id), {
          buffer: oversized,
          fileName: "giant_archive.zip",
          mimeType: "application/zip",
          attachmentType: "OTHER",
        })
      ).rejects.toThrow(/exceeds the maximum 25MB limit/i);
    });

    it("should generate 15-minute signed download URL with tamper-proof token", async () => {
      const updated = await NXDocument.findById(testDoc._id);
      const attachmentId = String(updated?.attachments[0].attachmentId || updated?.attachments[0]._id);

      const result = await docService.getDocumentAttachmentSignedUrl(
        adminUser,
        String(testDoc._id),
        attachmentId
      );

      expect(result.signedUrl).toContain("token=");
      expect(result.signedUrl).toContain(attachmentId);

      // Verify signature
      const valid = docService.verifyAttachmentSignedToken(result.signedUrl);
      expect(valid).toBe(true);
    });

    it("should prevent cross-tenant users from generating signed download URLs", async () => {
      const updated = await NXDocument.findById(testDoc._id);
      const attachmentId = String(updated?.attachments[0].attachmentId || updated?.attachments[0]._id);

      await expect(
        docService.getDocumentAttachmentSignedUrl(
          otherOrgUser,
          String(testDoc._id),
          attachmentId
        )
      ).rejects.toThrow(/FORBIDDEN_CROSS_TENANT/i);
    });
  });

  describe("6. Document Status Transitions & Immutable Activity History", () => {
    let statusDoc: any;

    beforeAll(async () => {
      statusDoc = await docService.registerDocument(adminUser, {
        title: "Vendor Onboarding Agreement",
        categoryCode: "VENDOR_MGMT",
        typeCode: "428", // Client Agreement
        recipientType: "VENDOR",
        recipientName: "Cloud Infrastructure Vendor",
      });
    });

    it("should transition status from DRAFT to ACTIVE and log to activity history", async () => {
      const updated = await docService.updateDocumentStatus(
        adminUser,
        String(statusDoc._id),
        "ACTIVE",
        "Signatures verified and counter-signed"
      );

      expect(updated.status).toBe("ACTIVE");
      const latestLog = updated.activityHistory[updated.activityHistory.length - 1];
      expect(latestLog.action).toBe("STATUS_CHANGED");
      expect(latestLog.notes).toContain("Signatures verified");
    });

    it("should archive document with reason and mark as ARCHIVED", async () => {
      const archived = await docService.archiveDocument(
        adminUser,
        String(statusDoc._id),
        "Contract superseded by 2027 master agreement"
      );

      expect(archived.status).toBe("ARCHIVED");
      expect(archived.isArchived).toBe(true);
      expect(archived.archivedReason).toBe("Contract superseded by 2027 master agreement");
      expect(archived.archivedAt).toBeDefined();
    });
  });

  describe("7. Super Admin Control Center Overview", () => {
    it("should aggregate platform statistics and independent headcounts", async () => {
      const overview = await adminService.getSuperAdminControlOverview(superAdminUser);

      expect(overview.headcounts.totalUsers).toBeGreaterThanOrEqual(3);
      expect(overview.documents.totalDocuments).toBeGreaterThanOrEqual(4);
      expect(overview.documents.allocationState.currentLiveAllocationCounter).toBeGreaterThanOrEqual(2);
      expect(overview.documents.allocationState.totalLegacyImports).toBeGreaterThanOrEqual(1);
      expect(overview.documents.systemRegistries.predefinedCategories).toBeGreaterThanOrEqual(11);
      expect(overview.documents.systemRegistries.predefinedTypes).toBeGreaterThanOrEqual(20);
      expect(overview.systemHealth.database).toBe("CONNECTED");
    });

    it("should reject non-admin from accessing Super Admin Control Center", async () => {
      await expect(
        adminService.getSuperAdminControlOverview(employeeUser)
      ).rejects.toThrow(/FORBIDDEN_ADMIN_ACCESS_REQUIRED/i);
    });
  });
});
