import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import Conversation from "../src/models/Conversation";
import Message from "../src/models/Message";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import Division from "../src/models/Division";
import * as communicationService from "../src/services/communicationService";
import { executeDatabaseBackup, restoreDatabaseBackup } from "../src/services/backupService";
import { initSocket, getSocket } from "../src/lib/socket";
import {
  emitMessageCreated,
  emitMessageDelivered,
  emitMessageRead,
} from "../src/lib/socketEmitters";
import http from "http";
import path from "path";
import fs from "fs";

describe("Phase 4: Complete Internal Messaging System, Security Audit & Production Verification", () => {
  let mongoServer: MongoMemoryServer;
  let server: http.Server;
  let io: any;

  let testOrgId: mongoose.Types.ObjectId;
  let otherOrgId: mongoose.Types.ObjectId;
  let divisionId: mongoose.Types.ObjectId;
  let deptId: mongoose.Types.ObjectId;
  let teamId: mongoose.Types.ObjectId;

  let adminUser: any;
  let employeeUser1: any;
  let employeeUser2: any;
  let employeeUser3: any;
  let otherOrgUser: any;

  let directConv: any;
  let groupConv: any;

  beforeAll(async () => {
    // 1. Initialize HTTP Server & Socket.IO
    server = http.createServer();
    io = initSocket(server);

    // 2. Start MongoMemoryServer
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGODB_URI = uri;
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }

    // 3. Organization 1
    const org = await Organization.create({
      name: "Phase 4 Primary Org",
      slug: "phase4-primary-org",
      status: "ACTIVE",
    });
    testOrgId = org._id as mongoose.Types.ObjectId;

    // 4. Organization 2 (Tenant isolation)
    const otherOrg = await Organization.create({
      name: "External Tenant Org",
      slug: "external-tenant-org",
      status: "ACTIVE",
    });
    otherOrgId = otherOrg._id as mongoose.Types.ObjectId;

    // 5. Division
    const division = await Division.create({
      name: "Engineering Division",
      code: "ENGD",
      organizationId: testOrgId,
      status: "ACTIVE",
    });
    divisionId = division._id as mongoose.Types.ObjectId;

    // 6. Department
    const dept = await Department.create({
      name: "Software Development",
      code: "SWD",
      organizationId: testOrgId,
      divisionId: divisionId,
    });
    deptId = dept._id as mongoose.Types.ObjectId;

    // 7. Team
    const team = await Team.create({
      name: "Platform Core",
      code: "CORE",
      organizationId: testOrgId,
      departmentId: deptId,
      divisionId: divisionId,
    });
    teamId = team._id as mongoose.Types.ObjectId;

    // 8. Admin User
    adminUser = await User.create({
      fullName: "Admin Alice",
      email: "alice@phase4.com",
      passwordHash: "securehash123",
      role: "ADMIN",
      organizationId: testOrgId,
      departmentId: deptId,
      divisionId: divisionId,
      status: "ACTIVE",
    });

    // 9. Employee 1
    employeeUser1 = await User.create({
      fullName: "Bob Engineer",
      email: "bob@phase4.com",
      passwordHash: "securehash123",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      divisionId: divisionId,
      status: "ACTIVE",
    });

    // 10. Employee 2
    employeeUser2 = await User.create({
      fullName: "Charlie QA",
      email: "charlie@phase4.com",
      passwordHash: "securehash123",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      divisionId: divisionId,
      status: "ACTIVE",
    });

    // 11. Employee 3
    employeeUser3 = await User.create({
      fullName: "Diana Designer",
      email: "diana@phase4.com",
      passwordHash: "securehash123",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      status: "ACTIVE",
    });

    // 12. Other Org User
    otherOrgUser = await User.create({
      fullName: "External Eve",
      email: "eve@external.com",
      passwordHash: "securehash123",
      role: "EMPLOYEE",
      organizationId: otherOrgId,
      status: "ACTIVE",
    });
  });

  afterAll(async () => {
    if (io) io.close();
    if (server) server.close();
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // -------------------------------------------------------------
  // 1. One-to-One Direct Messaging & Idempotency
  // -------------------------------------------------------------
  describe("1. One-to-One Direct Messaging & Idempotency", () => {
    it("should create direct conversation between two users and exchange messages", async () => {
      directConv = await communicationService.getOrCreateDirectConversation(
        employeeUser1,
        employeeUser2._id.toString()
      );

      expect(directConv).toBeDefined();
      expect(directConv.type).toBe("DIRECT");
      expect(directConv.participants).toHaveLength(2);

      const msg = await communicationService.sendMessage(
        employeeUser1,
        directConv._id.toString(),
        {
          body: "Hello Charlie, did you run the latest regression suite?",
          clientMessageId: "client-msg-001",
        }
      );

      expect(msg).toBeDefined();
      expect(msg.body).toBe("Hello Charlie, did you run the latest regression suite?");
      expect((msg.senderId._id || msg.senderId).toString()).toBe(employeeUser1._id.toString());
      expect(msg.status).toBe("SENT");
    });

    it("should enforce message idempotency when clientMessageId is repeated", async () => {
      const duplicateMsg = await communicationService.sendMessage(
        employeeUser1,
        directConv._id.toString(),
        {
          body: "Hello Charlie, did you run the latest regression suite?",
          clientMessageId: "client-msg-001",
        }
      );

      expect(duplicateMsg).toBeDefined();
      expect(duplicateMsg.clientMessageId).toBe("client-msg-001");

      const allMsgs = await Message.find({
        conversationId: directConv._id,
        clientMessageId: "client-msg-001",
      });
      expect(allMsgs).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------
  // 2. Real-Time Delivery & Read Receipts
  // -------------------------------------------------------------
  describe("2. Real-Time Delivery & Read Receipts", () => {
    it("should mark messages as DELIVERED when recipient receives them", async () => {
      const result = await communicationService.markMessagesDelivered(
        employeeUser2,
        directConv._id.toString()
      );

      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(1);

      const msg = await Message.findOne({
        conversationId: directConv._id,
        clientMessageId: "client-msg-001",
      });
      expect(msg?.status).toBe("DELIVERED");
      expect(msg?.deliveredTo.some((d: any) => (d.userId || d).toString() === employeeUser2._id.toString())).toBe(true);
    });

    it("should mark conversation and messages as READ when recipient opens chat", async () => {
      await communicationService.markConversationRead(
        employeeUser2,
        directConv._id.toString()
      );

      const msg = await Message.findOne({
        conversationId: directConv._id,
        clientMessageId: "client-msg-001",
      });
      expect(msg?.status).toBe("READ");
      expect(msg?.readBy.some((r: any) => r.userId.toString() === employeeUser2._id.toString())).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // 3. Attachments & Private Signed URL Access Control
  // -------------------------------------------------------------
  describe("3. Attachments & Secure Private File Sharing", () => {
    let uploadedImage: any;
    let uploadedPdf: any;

    it("should allow conversation participant to upload image attachment", async () => {
      // 1x1 PNG dummy base64
      const dummyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      uploadedImage = await communicationService.uploadConversationAttachment(
        employeeUser1,
        directConv._id.toString(),
        {
          fileName: "test_screenshot.png",
          mimeType: "image/png",
          buffer: Buffer.from(dummyPngBase64, "base64"),
        }
      );

      expect(uploadedImage).toBeDefined();
      expect(uploadedImage.originalName).toBe("test_screenshot.png");
      expect(uploadedImage.mimeType).toBe("image/png");
      expect(uploadedImage.size).toBeGreaterThan(0);
      expect(uploadedImage.storageKey).toBeDefined();
    });

    it("should allow conversation participant to upload document (PDF) attachment", async () => {
      const dummyPdfBuffer = Buffer.from("%PDF-1.4 mock content for phase 4 testing");

      uploadedPdf = await communicationService.uploadConversationAttachment(
        employeeUser1,
        directConv._id.toString(),
        {
          fileName: "spec_sheet.pdf",
          mimeType: "application/pdf",
          buffer: dummyPdfBuffer,
        }
      );

      expect(uploadedPdf).toBeDefined();
      expect(uploadedPdf.originalName).toBe("spec_sheet.pdf");
      expect(uploadedPdf.mimeType).toBe("application/pdf");
    });

    it("should reject attachment exceeding 25MB limit", async () => {
      await expect(
        communicationService.uploadConversationAttachment(
          employeeUser1,
          directConv._id.toString(),
          {
            fileName: "huge_video.mp4",
            mimeType: "video/mp4",
            fileSize: 26 * 1024 * 1024,
            buffer: Buffer.from("test"),
          }
        )
      ).rejects.toThrow();
    });

    it("should reject dangerous or unpermitted executable attachments", async () => {
      await expect(
        communicationService.uploadConversationAttachment(
          employeeUser1,
          directConv._id.toString(),
          {
            fileName: "malware.exe",
            mimeType: "application/x-msdownload",
            buffer: Buffer.from("test"),
          }
        )
      ).rejects.toThrow();
    });

    it("should allow conversation participants to generate signed download access URL", async () => {
      // First send a message referencing this attachment
      await communicationService.sendMessage(
        employeeUser1,
        directConv._id.toString(),
        {
          body: "Sharing screenshot",
          attachments: [
            {
              attachmentId: uploadedImage.attachmentId,
              originalName: uploadedImage.originalName,
              size: uploadedImage.size,
              mimeType: uploadedImage.mimeType,
              storageKey: uploadedImage.storageKey,
              url: uploadedImage.url,
            },
          ],
        }
      );

      const access = await communicationService.getAttachmentAccess(
        employeeUser2, // Recipient participant
        directConv._id.toString(),
        uploadedImage.attachmentId
      );

      expect(access).toBeDefined();
      expect(access.signedUrl).toBeDefined();
      expect(access.attachment).toBeDefined();
    });

    it("should reject attachment access by non-participant in conversation", async () => {
      await expect(
        communicationService.getAttachmentAccess(
          employeeUser3, // In same org, but not participant in directConv
          directConv._id.toString(),
          uploadedImage.attachmentId
        )
      ).rejects.toThrow("FORBIDDEN");
    });

    it("should reject attachment access across tenants", async () => {
      await expect(
        communicationService.getAttachmentAccess(
          otherOrgUser, // In different org
          directConv._id.toString(),
          uploadedImage.attachmentId
        )
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------
  // 4. Group Conversations & Role-Based Member Management
  // -------------------------------------------------------------
  describe("4. Group Conversations & Role-Based Member Management", () => {
    it("should create a group conversation with initial participants and admins", async () => {
      groupConv = await communicationService.createGroupConversation(
        adminUser,
        {
          name: "Core Engineering Team",
          description: "All core platform engineers and testers",
          participantIds: [employeeUser1._id.toString(), employeeUser2._id.toString()],
          divisionId: divisionId.toString(),
          departmentId: deptId.toString(),
        }
      );

      expect(groupConv).toBeDefined();
      expect(groupConv.type).toBe("GROUP");
      expect(groupConv.name).toBe("Core Engineering Team");
      expect(groupConv.admins.map((a: any) => a.toString())).toContain(adminUser._id.toString());
      expect(groupConv.participants).toHaveLength(3); // admin + 2 employees
    });

    it("should allow group admin to add new participants", async () => {
      const updated = await communicationService.addParticipantsToGroup(
        adminUser,
        groupConv._id.toString(),
        [employeeUser3._id.toString()]
      );

      expect(updated.participants).toHaveLength(4);
      expect(updated.participants.map((p: any) => (p._id || p).toString())).toContain(employeeUser3._id.toString());
    });

    it("should prevent non-admin from adding participants to the group", async () => {
      await expect(
        communicationService.addParticipantsToGroup(
          employeeUser1, // Not group admin
          groupConv._id.toString(),
          [adminUser._id.toString()]
        )
      ).rejects.toThrow("FORBIDDEN");
    });

    it("should allow group admin to update group details (name, description)", async () => {
      const updated = await communicationService.updateGroupDetails(
        adminUser,
        groupConv._id.toString(),
        {
          name: "Core Engineering & Design",
          description: "Updated description for group",
        }
      );

      expect(updated.name).toBe("Core Engineering & Design");
      expect(updated.description).toBe("Updated description for group");
    });

    it("should allow a participant to leave the group voluntarily", async () => {
      const result = await communicationService.leaveGroup(
        employeeUser3,
        groupConv._id.toString()
      );

      expect(result.success).toBe(true);

      const conv = await Conversation.findById(groupConv._id);
      expect(conv?.participants.map((p: any) => p.toString())).not.toContain(employeeUser3._id.toString());
    });

    it("should allow group admin to remove a participant", async () => {
      const updated = await communicationService.removeParticipantFromGroup(
        adminUser,
        groupConv._id.toString(),
        employeeUser2._id.toString()
      );

      expect(updated.participants.map((p: any) => (p._id || p).toString())).not.toContain(employeeUser2._id.toString());
    });
  });

  // -------------------------------------------------------------
  // 5. Socket.IO Security, Room Validation & Non-Leaking Broadcast
  // -------------------------------------------------------------
  describe("5. Socket.IO Security & Targeted Room Broadcasts", () => {
    it("should have initialized Socket.IO server securely", () => {
      expect(io).toBeDefined();
      expect(getSocket()).toBe(io);
    });

    it("should emit message created strictly to conversation room and participants, NOT org-wide room", () => {
      const emittedRooms: string[] = [];
      jest.spyOn(io, "to").mockImplementation((room: string) => {
        emittedRooms.push(room);
        return { emit: () => {} } as any;
      });

      const mockMsg = {
        _id: new mongoose.Types.ObjectId(),
        conversationId: "conv-456",
        body: "Hello private chat",
        toObject: () => ({ _id: "m1", body: "Hello private chat" }),
      };

      const mockConv = {
        _id: "conv-456",
        participants: [{ _id: "user-bob" }, { _id: "user-charlie" }],
      };

      emitMessageCreated(mockMsg as any, mockConv as any, "org-primary-789");

      // Verify emitted to conversation:conv-456 and individual user: rooms
      expect(emittedRooms).toContain("conversation:conv-456");
      expect(emittedRooms).toContain("user:user-bob");
      expect(emittedRooms).toContain("user:user-charlie");

      // CRITICAL SECURITY ASSERTION: Must NOT broadcast private message to organization room!
      expect(emittedRooms).not.toContain("org:org-primary-789");
    });

    it("should emit delivery and read receipts strictly to conversation and participant rooms", () => {
      const emittedRooms: string[] = [];
      jest.spyOn(io, "to").mockImplementation((room: string) => {
        emittedRooms.push(room);
        return { emit: () => {} } as any;
      });

      emitMessageDelivered(
        { _id: "msg-1", conversationId: "conv-456" } as any,
        "conv-456",
        ["user-bob", "user-charlie"]
      );

      emitMessageRead(
        { _id: "msg-1", conversationId: "conv-456" } as any,
        "conv-456",
        ["user-bob", "user-charlie"]
      );

      expect(emittedRooms).not.toContain("org:org-primary-789");
    });
  });

  // -------------------------------------------------------------
  // 6. Database Automated Backup, Manifest & Restoration
  // -------------------------------------------------------------
  describe("6. Database Automated Backup & Disaster Recovery", () => {
    let backupResult: any;

    it("should execute automated database backup, write non-empty collections, manifest and SHA-256", async () => {
      const testBackupDir = path.join(__dirname, "../temp_backup_test");
      backupResult = await executeDatabaseBackup({
        backupDirectory: testBackupDir,
      });

      expect(backupResult).toBeDefined();
      expect(backupResult.success).toBe(true);
      expect(backupResult.backupId).toBeDefined();
      expect(backupResult.manifest).toBeDefined();
      expect(backupResult.manifest.totalDocuments).toBeGreaterThan(0);
      expect(backupResult.manifest.sha256Checksum).toHaveLength(64); // SHA-256 hex string

      const manifestOnDisk = JSON.parse(
        fs.readFileSync(path.join(backupResult.backupDirectory, "manifest.json"), "utf8")
      );
      expect(manifestOnDisk.backupId).toBe(backupResult.backupId);
      expect(manifestOnDisk.collections.length).toBeGreaterThan(0);
    });

    it("should successfully restore database backup verifying SHA-256 integrity checksums", async () => {
      const restoreResult = await restoreDatabaseBackup(backupResult.backupDirectory);

      expect(restoreResult).toBeDefined();
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.verifiedChecksums).toBe(true);
      expect(restoreResult.collectionsRestored).toBeGreaterThan(0);

      // Clean up temp test backup directory
      try {
        fs.rmSync(backupResult.backupDirectory, { recursive: true, force: true });
        const parentDir = path.dirname(backupResult.backupDirectory);
        if (fs.readdirSync(parentDir).length === 0) {
          fs.rmdirSync(parentDir);
        }
      } catch (_) {}
    });
  });
});
