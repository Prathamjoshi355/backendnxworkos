import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Organization } from "../src/models/Organization";
import { User } from "../src/models/User";
import { Candidate } from "../src/models/Candidate";
import { NXDocument } from "../src/models/NXDocument";
import * as docService from "../src/services/documentManagementService";
import { OFFICIAL_COMPANY_CIN } from "../src/services/documentIdService";

describe("Registered Documents - Employee / Intern / Candidate Assignment Test Suite", () => {
  let mongoServer: MongoMemoryServer;
  let orgId: mongoose.Types.ObjectId;
  let division1Id: mongoose.Types.ObjectId;
  let division2Id: mongoose.Types.ObjectId;

  let superAdminUser: any;
  let hrUser: any;
  let division1Admin: any;
  let employeeUser: any;
  let internUser: any;
  let candidateRecord: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    orgId = new mongoose.Types.ObjectId();
    division1Id = new mongoose.Types.ObjectId();
    division2Id = new mongoose.Types.ObjectId();

    await Organization.create({
      _id: orgId,
      name: "NexisparkX Private Limited",
      code: "NX",
      status: "ACTIVE",
    });

    superAdminUser = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Super Admin",
      email: "superadmin@nexisparkx.com",
      role: "SUPER_ADMIN",
      organizationId: orgId,
      permissions: ["documents:create", "documents:manage"],
    };

    hrUser = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "HR Officer",
      email: "hr@nexisparkx.com",
      role: "HR",
      organizationId: orgId,
      permissions: ["documents:create", "documents:manage"],
    };

    division1Admin = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Division 1 Lead",
      email: "div1admin@nexisparkx.com",
      role: "DIVISION_ADMIN",
      organizationId: orgId,
      divisionId: division1Id,
      permissions: ["documents:create"],
    };

    // Employee
    employeeUser = await User.create({
      _id: new mongoose.Types.ObjectId(),
      fullName: "Alice Employee",
      email: "alice@nexisparkx.com",
      passwordHash: "hashed_dummy_password",
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      employmentClassification: "FULL_TIME_EMPLOYEE",
      employeeId: "NX-EMP-0010",
      organizationId: orgId,
      divisionId: division1Id,
      status: "ACTIVE",
    });

    // Intern
    internUser = await User.create({
      _id: new mongoose.Types.ObjectId(),
      fullName: "Bob Intern",
      email: "bob@nexisparkx.com",
      passwordHash: "hashed_dummy_password",
      role: "INTERN",
      employmentType: "INTERN",
      employmentClassification: "FULL_TIME_INTERN",
      employeeId: "NX-INT-0005",
      organizationId: orgId,
      divisionId: division1Id,
      status: "ACTIVE",
    });

    // Candidate
    candidateRecord = await Candidate.create({
      _id: new mongoose.Types.ObjectId(),
      candidateId: "CAN-261103-001",
      fullName: "Charlie Candidate",
      email: "charlie@example.com",
      designation: "Junior Developer",
      departmentId: "NX-HQ-DV",
      divisionId: division1Id,
      organizationId: orgId,
      status: "OFFER_SENT",
      offerType: "EMPLOYEE_OFFER",
      createdBy: hrUser._id,
    });

    await docService.ensurePredefinedDocumentCatalog(String(orgId));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  describe("1. Document Type Compatibility Rules", () => {
    it("should allow Offer Letter registration for CANDIDATE and reject for EMPLOYEE", async () => {
      // 1. Successful candidate offer letter
      const doc = await docService.createDocument(hrUser, {
        title: "Offer Letter - Charlie Candidate",
        documentTypeCode: "731", // Employee Offer Letter
        assignedPersonType: "CANDIDATE",
        assignedPersonId: candidateRecord.candidateId,
      });

      expect(doc.documentId).toMatch(new RegExp(`^N${OFFICIAL_COMPANY_CIN}\\d{12}$`));
      expect(doc.assignedPersonType).toBe("CANDIDATE");
      expect(doc.assignedPersonId).toBe("CAN-261103-001");
      expect(doc.assignedPersonName).toBe("Charlie Candidate");
      expect(doc.candidateId?.toString()).toBe(candidateRecord._id.toString());
      expect(doc.employeeId).toBeNull();

      // Verify Candidate record was updated with offer document ref
      const updatedCandidate = await Candidate.findById(candidateRecord._id);
      expect(updatedCandidate?.offerDocumentId).toBe(doc.documentId);

      // 2. Reject offer letter for regular employee
      await expect(
        docService.createDocument(hrUser, {
          title: "Offer Letter - Invalid Employee",
          documentTypeCode: "731",
          assignedPersonType: "EMPLOYEE",
          assignedPersonId: employeeUser.employeeId,
        })
      ).rejects.toThrow("INCOMPATIBLE_PERSON_TYPE");
    });

    it("should allow Promotion Letter for EMPLOYEE and reject for INTERN and CANDIDATE", async () => {
      // 1. Success for EMPLOYEE
      const doc = await docService.createDocument(hrUser, {
        title: "Promotion to Senior Engineer - Alice",
        documentTypeCode: "817", // Promotion Letter
        assignedPersonType: "EMPLOYEE",
        assignedPersonId: employeeUser.employeeId,
      });

      expect(doc.assignedPersonType).toBe("EMPLOYEE");
      expect(doc.assignedPersonId).toBe("NX-EMP-0010");
      expect(doc.assignedPersonName).toBe("Alice Employee");
      expect(doc.employeeId?.toString()).toBe(employeeUser._id.toString());
      expect(doc.internId).toBeNull();
      expect(doc.candidateId).toBeNull();

      // 2. Reject for INTERN
      await expect(
        docService.createDocument(hrUser, {
          title: "Promotion Letter - Invalid Intern",
          documentTypeCode: "817",
          assignedPersonType: "INTERN",
          assignedPersonId: internUser.employeeId,
        })
      ).rejects.toThrow("INCOMPATIBLE_PERSON_TYPE");

      // 3. Reject for CANDIDATE
      await expect(
        docService.createDocument(hrUser, {
          title: "Promotion Letter - Invalid Candidate",
          documentTypeCode: "817",
          assignedPersonType: "CANDIDATE",
          assignedPersonId: candidateRecord.candidateId,
        })
      ).rejects.toThrow("INCOMPATIBLE_PERSON_TYPE");
    });

    it("should allow Internship Extension Letter for INTERN and reject for EMPLOYEE", async () => {
      // 1. Success for INTERN
      const doc = await docService.createDocument(hrUser, {
        title: "Internship Extension - Bob Intern",
        documentTypeCode: "627", // Internship Extension Letter
        assignedPersonType: "INTERN",
        assignedPersonId: internUser.employeeId,
      });

      expect(doc.assignedPersonType).toBe("INTERN");
      expect(doc.assignedPersonId).toBe("NX-INT-0005");
      expect(doc.assignedPersonName).toBe("Bob Intern");
      expect(doc.internId?.toString()).toBe(internUser._id.toString());
      expect(doc.employeeId).toBeNull();

      // 2. Reject for regular EMPLOYEE
      await expect(
        docService.createDocument(hrUser, {
          title: "Internship Extension - Invalid Employee",
          documentTypeCode: "627",
          assignedPersonType: "EMPLOYEE",
          assignedPersonId: employeeUser.employeeId,
        })
      ).rejects.toThrow("INCOMPATIBLE_PERSON_TYPE");
    });

    it("should allow Relieving Letter and Salary Slip for both EMPLOYEE and INTERN", async () => {
      // Relieving Letter for EMPLOYEE
      const empRelieving = await docService.createDocument(hrUser, {
        title: "Relieving Letter - Alice Employee",
        documentTypeCode: "913", // Relieving Letter
        assignedPersonType: "EMPLOYEE",
        assignedPersonId: employeeUser.employeeId,
      });
      expect(empRelieving.assignedPersonType).toBe("EMPLOYEE");
      expect(empRelieving.employeeId?.toString()).toBe(employeeUser._id.toString());

      // Relieving Letter for INTERN
      const internRelieving = await docService.createDocument(hrUser, {
        title: "Relieving Letter - Bob Intern",
        documentTypeCode: "913", // Relieving Letter
        assignedPersonType: "INTERN",
        assignedPersonId: internUser.employeeId,
      });
      expect(internRelieving.assignedPersonType).toBe("INTERN");
      expect(internRelieving.internId?.toString()).toBe(internUser._id.toString());
    });
  });

  describe("2. ID Distinction & Immutability Protection", () => {
    it("should maintain separation between Document ID and Person ID", async () => {
      const doc = await docService.createDocument(hrUser, {
        title: "Appointment Letter - Alice Employee",
        documentTypeCode: "331", // Appointment Letter
        assignedPersonType: "EMPLOYEE",
        assignedPersonId: employeeUser.employeeId,
      });

      // Document ID structure check: N + CIN + YYMMDD + RRR + TTT (34 characters total)
      expect(doc.documentId.startsWith(`N${OFFICIAL_COMPANY_CIN}`)).toBe(true);
      expect(doc.documentId.length).toBe(34);

      // Person ID structure check
      expect(doc.assignedPersonId).toBe("NX-EMP-0010");
      expect(doc.documentId).not.toBe(doc.assignedPersonId);
    });

    it("should prevent reassignment of already registered document", async () => {
      const doc = await docService.createDocument(hrUser, {
        title: "Employee Confirmation - Alice",
        documentTypeCode: "835", // Employee Confirmation Letter
        assignedPersonType: "EMPLOYEE",
        assignedPersonId: employeeUser.employeeId,
      });

      // Attempting to reassign person must throw CANNOT_REASSIGN_DOCUMENT
      await expect(
        docService.updateDocumentMetadata(hrUser, String(doc._id), {
          assignedPersonId: "NX-EMP-9999",
        } as any)
      ).rejects.toThrow("CANNOT_REASSIGN_DOCUMENT");
    });
  });

  describe("3. Organizational & Division Boundary Checks", () => {
    it("should prevent division admin from assigning documents to staff outside their division", async () => {
      // Create user in Division 2
      const div2User = await User.create({
        _id: new mongoose.Types.ObjectId(),
        fullName: "Division 2 Employee",
        email: "div2emp@nexisparkx.com",
        passwordHash: "hashed_dummy_password",
        role: "EMPLOYEE",
        employmentType: "EMPLOYEE",
        employmentClassification: "FULL_TIME_EMPLOYEE",
        employeeId: "NX-EMP-0020",
        organizationId: orgId,
        divisionId: division2Id,
        status: "ACTIVE",
      });

      await expect(
        docService.createDocument(division1Admin, {
          title: "Cross Division Appointment",
          documentTypeCode: "331",
          divisionId: String(division1Id),
          assignedPersonType: "EMPLOYEE",
          assignedPersonId: div2User.employeeId,
        })
      ).rejects.toThrow("FORBIDDEN: Cannot assign documents to staff outside your assigned division.");
    });
  });
});
