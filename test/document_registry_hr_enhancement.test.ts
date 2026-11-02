import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getDocumentTypeEntry } from "../src/constants/documentTypeCodes";
import { initializeDefaultDepartmentsForOrg, safeDeactivateDepartment } from "../src/services/departmentService";
import { Department } from "../src/models/Department";
import { Organization } from "../src/models/Organization";
import { User } from "../src/models/User";
import { NXDocument } from "../src/models/NXDocument";
import { EmployeeDocument } from "../src/models/EmployeeDocument";
import { Candidate } from "../src/models/Candidate";
import * as candidateOfferService from "../src/services/candidateOfferService";
import * as docService from "../src/services/documentManagementService";
import * as searchService from "../src/services/searchService";
import { Task } from "../src/models/Task";

describe("Document Registry, Department Defaults & HR Workflow Enhancement Test Suite", () => {
  let mongoServer: MongoMemoryServer;
  let orgId: mongoose.Types.ObjectId;
  let superAdminUser: any;
  let hrUser: any;
  let employeeUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    orgId = new mongoose.Types.ObjectId();

    await Organization.create({
      _id: orgId,
      name: "NexisparkX Private Limited",
      code: "NX",
      status: "ACTIVE",
    });

    superAdminUser = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Super Admin",
      email: "admin@nexisparkx.com",
      role: "SUPER_ADMIN",
      organizationId: orgId,
    };

    hrUser = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "HR Manager",
      email: "hr@nexisparkx.com",
      role: "HR",
      organizationId: orgId,
    };

    employeeUser = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Regular Employee",
      email: "emp@nexisparkx.com",
      role: "EMPLOYEE",
      organizationId: orgId,
    };

    // Seed the document catalog (categories & types) in MongoMemoryServer
    await docService.ensurePredefinedDocumentCatalog(String(orgId));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  describe("1. Document Type Codes & Canonical Cleaning", () => {
    it("should distinguish EMPLOYEE_OFFER_LETTER (731) and INTERNSHIP_OFFER_LETTER (493)", () => {
      const empEntry = getDocumentTypeEntry("EMPLOYEE_OFFER_LETTER");
      const internEntry = getDocumentTypeEntry("INTERNSHIP_OFFER_LETTER");

      expect(empEntry).toBeDefined();
      expect(internEntry).toBeDefined();
      expect(empEntry!.code).toBe("731");
      expect(internEntry!.code).toBe("493");
      expect(empEntry!.code).not.toBe(internEntry!.code);
    });

    it("should resolve canonical WARNING_LETTER as 914", () => {
      const warnEntry = getDocumentTypeEntry("WARNING_LETTER");
      expect(warnEntry).toBeDefined();
      expect(warnEntry!.code).toBe("914");
    });

    it("should resolve legacy aliases to canonical codes", () => {
      expect(getDocumentTypeEntry("OFFER_LETTER")?.code).toBe("731");
      expect(getDocumentTypeEntry("INTERNSHIP_OFFER")?.code).toBe("493");
      expect(getDocumentTypeEntry("JOB_OFFER")?.code).toBe("512");
    });
  });

  describe("2. Default Organization Departments & Safe Deactivation", () => {
    it("should initialize 12 default departments idempotently", async () => {
      const firstInit = await initializeDefaultDepartmentsForOrg(orgId, superAdminUser._id);
      expect(firstInit.created.length).toBe(12);
      expect(firstInit.existing.length).toBe(0);

      const deptCount = await Department.countDocuments({ organizationId: orgId });
      expect(deptCount).toBe(12);

      // Re-running initialization should be idempotent
      const secondInit = await initializeDefaultDepartmentsForOrg(orgId, superAdminUser._id);
      expect(secondInit.created.length).toBe(0);
      expect(secondInit.existing.length).toBe(12);
    });

    it("should safely prevent deactivating a department if active users exist", async () => {
      const itDept = await Department.findOne({ organizationId: orgId, code: "IT" });
      expect(itDept).toBeDefined();

      // Create an active user in the IT department
      const user = await User.create({
        fullName: "IT Specialist",
        email: "itspec@nexisparkx.com",
        passwordHash: "hash123",
        role: "EMPLOYEE",
        employeeId: "NX-EMP-9001",
        organizationId: orgId,
        departmentId: String(itDept!._id),
        status: "ACTIVE",
      });

      await expect(
        safeDeactivateDepartment(itDept!._id, superAdminUser)
      ).rejects.toThrow("DEPARTMENT_HAS_ACTIVE_MEMBERS");

      // Cleanup user
      await User.findByIdAndDelete(user._id);
    });

    it("should allow deactivating a department if no active users or teams exist", async () => {
      const rndDept = await Department.findOne({ organizationId: orgId, code: "R_AND_D" });
      expect(rndDept).toBeDefined();

      const deactivated = await safeDeactivateDepartment(rndDept!._id, superAdminUser);
      expect(deactivated.status).toBe("INACTIVE");
    });
  });

  describe("3. Document Registry & Single Original Attachment", () => {
    let createdDoc: any;

    it("should create registered document with auto-resolved category and status DRAFT", async () => {
      createdDoc = await docService.createDocument(hrUser, {
        title: "Company Confidential Policy",
        documentType: "POLICY_DOCUMENT",
        language: "EN",
      });

      expect(createdDoc).toBeDefined();
      expect(createdDoc.documentId).toMatch(/^NU62099MP2026PTC084748/);
      expect(createdDoc.status).toBe("DRAFT");
      expect(createdDoc.categoryId).toBeDefined();
    });

    it("should successfully attach the first ORIGINAL attachment", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4 Mock Document Content");
      const attachment = await docService.uploadDocumentAttachment(hrUser, createdDoc._id, {
        buffer: pdfBuffer,
        fileName: "policy.pdf",
        mimeType: "application/pdf",
        attachmentType: "ORIGINAL",
      });

      expect(attachment).toBeDefined();
      expect(attachment.fileName).toBe("policy.pdf");

      const doc = await NXDocument.findById(createdDoc._id);
      expect(doc).toBeDefined();
      expect(doc!.attachments.length).toBe(1);
      expect(doc!.attachments[0].attachmentType).toBe("ORIGINAL");
    });

    it("should reject a second ORIGINAL attachment on the same document", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4 Conflicting Upload");
      await expect(
        docService.uploadDocumentAttachment(hrUser, createdDoc._id, {
          buffer: pdfBuffer,
          fileName: "duplicate.pdf",
          mimeType: "application/pdf",
          attachmentType: "ORIGINAL",
        })
      ).rejects.toThrow("ATTACHMENT_ALREADY_EXISTS");
    });
  });

  describe("4. Candidate Lifecycle, 7-Day Expiry & Acceptance Letter Onboarding", () => {
    let candidate: any;

    it("should create a candidate with candidateId format CAN-YYMMDD-XXX", async () => {
      candidate = await candidateOfferService.createCandidate(hrUser, {
        fullName: "Jane Doe Candidate",
        email: "janedoe@example.com",
        phone: "+91 9876543210",
        designation: "Frontend Engineer",
        offerType: "EMPLOYEE_OFFER",
      });

      expect(candidate).toBeDefined();
      expect(candidate.candidateId).toMatch(/^CAN-\d{6}-\d{3}$/);
      expect(candidate.status).toBe("CANDIDATE");
    });

    it("should generate an offer document with code 731 and status OFFER_PREPARED", async () => {
      const { candidate: updated, document: doc } = await candidateOfferService.generateOfferForCandidate(
        hrUser,
        candidate._id,
        {
          offerType: "EMPLOYEE_OFFER",
          compensationAmount: 750000,
        }
      );
      expect(updated.status).toBe("OFFER_PREPARED");
      expect(updated.offerDocumentId).toMatch(/^NU62099MP2026PTC084748\d{6}\d{3}731$/);
      expect(doc.documentId).toBe(updated.offerDocumentId);
      candidate = updated;
    });

    it("should send the offer and start the 7-day expiration window", async () => {
      const sent = await candidateOfferService.sendOfferToCandidate(hrUser, candidate._id);
      expect(sent.status).toBe("OFFER_SENT");
      expect(sent.offerSentAt).toBeDefined();
      expect(sent.offerExpiresAt).toBeDefined();

      const diffDays = Math.round(
        (sent.offerExpiresAt!.getTime() - sent.offerSentAt!.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diffDays).toBe(7);
      candidate = sent;
    });

    it("should allow candidate to submit signed offer and HR to approve", async () => {
      const signedBuffer = Buffer.from("%PDF-1.4 Jane Doe Signed Offer");
      const submitted = await candidateOfferService.submitSignedOffer(candidate._id, {
        buffer: signedBuffer,
        fileName: "jane_doe_signed_offer.pdf",
        mimeType: "application/pdf",
      });
      expect(submitted.status).toBe("DOCUMENT_SUBMITTED");

      const approved = await candidateOfferService.reviewOfferSubmission(
        hrUser,
        candidate._id,
        "APPROVE",
        "Document verified and acceptable"
      );
      expect(approved.status).toBe("APPROVED");
      candidate = approved;
    });

    it("should reject onboarding if Acceptance Letter is missing or invalid PDF", async () => {
      // Missing letter
      await expect(
        candidateOfferService.onboardApprovedCandidate(hrUser, candidate._id, {
          requireAcceptanceLetter: true,
        })
      ).rejects.toThrow("MANDATORY_ACCEPTANCE_LETTER_REQUIRED");

      // Invalid non-PDF file
      await expect(
        candidateOfferService.onboardApprovedCandidate(hrUser, candidate._id, {
          acceptanceLetterFile: {
            buffer: Buffer.from("NOT_A_PDF_CONTENT"),
            fileName: "acceptance.txt",
            mimeType: "text/plain",
          },
        })
      ).rejects.toThrow("INVALID_PDF_FILE");
    });

    it("should successfully onboard candidate with valid PDF acceptance letter and link Offer Document ID", async () => {
      const validPdfBuffer = Buffer.from("%PDF-1.4 Jane Doe Official Acceptance Letter Content");
      const { candidate: joinedCandidate, user: newUser } = await candidateOfferService.onboardApprovedCandidate(
        hrUser,
        candidate._id,
        {
          acceptanceLetterFile: {
            buffer: validPdfBuffer,
            fileName: "jane_doe_acceptance_letter.pdf",
            mimeType: "application/pdf",
          },
        }
      );

      expect(joinedCandidate.status).toBe("JOINED");
      expect(joinedCandidate.convertedEmployeeId).toBe(newUser.employeeId);
      expect(newUser.employeeId).toMatch(/^NX-EMP-\d{4}$/);
      expect(newUser.mustChangePassword).toBe(true);

      // Verify Acceptance Letter was recorded in EmployeeDocument
      const empDoc = await EmployeeDocument.findOne({
        userId: newUser._id,
        documentType: "ACCEPTANCE_LETTER",
      });
      expect(empDoc).toBeDefined();
      expect(empDoc!.status).toBe("SUBMITTED");
    });
  });

  describe("5. Global Search Role-Scoped Restrictions", () => {
    it("should scope task searches for non-leadership employees to own tasks only", async () => {
      const task1 = await Task.create({
        taskId: "TASK-TEST-001",
        title: "Jane Employee Active Task",
        assignedTo: employeeUser._id,
        assignedBy: hrUser._id,
        createdBy: hrUser._id,
        organizationId: orgId,
        status: "TODO",
      });

      const task2 = await Task.create({
        taskId: "TASK-TEST-002",
        title: "Secret Confidential Board Task",
        assignedTo: new mongoose.Types.ObjectId(),
        assignedBy: hrUser._id,
        createdBy: hrUser._id,
        organizationId: orgId,
        status: "TODO",
      });

      const res = await searchService.globalSearch("Task", employeeUser, { type: "TASK" });
      const taskItems = res.results.filter((r) => r.entityType === "TASK");
      const resultIds = taskItems.map((t: any) => String(t.resultId));

      expect(resultIds).toContain(task1.taskId);
      expect(resultIds).not.toContain(task2.taskId);
    });
  });
});
