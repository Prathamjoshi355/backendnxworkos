import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Conversation from "../src/models/Conversation";
import Message from "../src/models/Message";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import * as communicationService from "../src/services/communicationService";

describe("Communication & Internal Collaboration End-to-End Tests", () => {
  let mongoServer: MongoMemoryServer;
  let testOrgId: mongoose.Types.ObjectId;
  let otherOrgId: mongoose.Types.ObjectId;
  let deptId: mongoose.Types.ObjectId;
  let teamId: mongoose.Types.ObjectId;
  let adminUser: any;
  let employeeUser1: any;
  let employeeUser2: any;
  let employeeUser3: any;
  let otherOrgUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Create Main Org
    const org = await Organization.create({
      name: "Comm Test Org",
      slug: "comm-test-org",
      status: "ACTIVE",
    });
    testOrgId = org._id as mongoose.Types.ObjectId;

    // Create Other Org
    const otherOrg = await Organization.create({
      name: "Other Org",
      slug: "other-org",
      status: "ACTIVE",
    });
    otherOrgId = otherOrg._id as mongoose.Types.ObjectId;

    // Create Department
    const dept = await Department.create({
      name: "Engineering",
      code: "ENG",
      organizationId: testOrgId,
    });
    deptId = dept._id as mongoose.Types.ObjectId;

    // Create Team
    const team = await Team.create({
      name: "Product Design",
      code: "DESIGN",
      organizationId: testOrgId,
      departmentId: deptId,
    });
    teamId = team._id as mongoose.Types.ObjectId;

    // Create Users
    adminUser = await User.create({
      fullName: "Admin Alice",
      email: "alice@commtest.com",
      passwordHash: "hash123",
      role: "ADMIN",
      organizationId: testOrgId,
      departmentId: deptId,
      status: "ACTIVE",
    });

    employeeUser1 = await User.create({
      fullName: "Employee Bob",
      email: "bob@commtest.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
    });

    employeeUser2 = await User.create({
      fullName: "Employee Charlie",
      email: "charlie@commtest.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
    });

    employeeUser3 = await User.create({
      fullName: "Employee Dave",
      email: "dave@commtest.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      status: "ACTIVE",
    });

    otherOrgUser = await User.create({
      fullName: "Outsider Eve",
      email: "eve@otherorg.com",
      passwordHash: "hash123",
      role: "EMPLOYEE",
      organizationId: otherOrgId,
      status: "ACTIVE",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("1. Search Active Collaborators", () => {
    it("should search colleagues within same organization only", async () => {
      const results = await communicationService.searchCollaborators(employeeUser1, "Admin");
      expect(results).toHaveLength(1);
      expect(results[0].fullName).toBe("Admin Alice");

      const allColleagues = await communicationService.searchCollaborators(employeeUser1);
      expect(allColleagues.length).toBeGreaterThanOrEqual(3);
      // Other org user should not appear
      expect(allColleagues.some((u: any) => u.email === "eve@otherorg.com")).toBe(false);
    });
  });

  describe("2. Direct Messaging & Deduplication", () => {
    let directConv: any;

    it("should create a 1-on-1 direct conversation between Bob and Charlie", async () => {
      directConv = await communicationService.getOrCreateDirectConversation(
        employeeUser1,
        employeeUser2._id.toString()
      );

      expect(directConv).toBeDefined();
      expect(directConv.type).toBe("DIRECT");
      expect(directConv.participants.map((p: any) => p._id ? p._id.toString() : p.toString())).toContain(employeeUser1._id.toString());
      expect(directConv.participants.map((p: any) => p._id ? p._id.toString() : p.toString())).toContain(employeeUser2._id.toString());
      expect(directConv.organizationId.toString()).toBe(testOrgId.toString());
    });

    it("should deduplicate and return the existing conversation when inverted or re-requested", async () => {
      const secondCall = await communicationService.getOrCreateDirectConversation(
        employeeUser2,
        employeeUser1._id.toString()
      );

      expect(secondCall._id.toString()).toBe(directConv._id.toString());
      expect(secondCall.conversationId).toBe(directConv.conversationId);
    });

    it("should reject direct conversation with user from another organization", async () => {
      await expect(
        communicationService.getOrCreateDirectConversation(
          employeeUser1,
          otherOrgUser._id.toString()
        )
      ).rejects.toThrow("RECIPIENT_NOT_FOUND");
    });
  });

  describe("3. Group Conversation Creation & Scoping", () => {
    let groupConv: any;

    it("should create a group conversation with multiple participants", async () => {
      groupConv = await communicationService.createGroupConversation(
        adminUser,
        {
          name: "Design Sprint Sync",
          participantIds: [
            employeeUser1._id.toString(),
            employeeUser2._id.toString(),
            employeeUser3._id.toString(),
          ],
        }
      );

      expect(groupConv).toBeDefined();
      expect(groupConv.type).toBe("GROUP");
      expect(groupConv.name).toBe("Design Sprint Sync");
      expect(groupConv.participants.length).toBe(4); // Alice (creator) + Bob, Charlie, Dave
    });

    it("should reject group creation if any participant belongs to another org", async () => {
      await expect(
        communicationService.createGroupConversation(
          adminUser,
          {
            name: "Invalid Cross Org Group",
            participantIds: [
              employeeUser1._id.toString(),
              otherOrgUser._id.toString(),
            ],
          }
        )
      ).rejects.toThrow("INVALID_PARTICIPANT_ORGANIZATION");
    });
  });

  describe("4. Sending Messages & Idempotency", () => {
    let conv: any;
    let firstMsg: any;

    beforeAll(async () => {
      conv = await communicationService.getOrCreateDirectConversation(
        employeeUser1,
        employeeUser2._id.toString()
      );
    });

    it("should send a message, update lastMessage, and increment recipient unreadCount", async () => {
      firstMsg = await communicationService.sendMessage(
        employeeUser1,
        conv._id.toString(),
        {
          body: "Hello Charlie, let's sync on the new UI specs.",
          clientMessageId: "client-uuid-001",
        }
      );

      expect(firstMsg).toBeDefined();
      expect(firstMsg.body).toBe("Hello Charlie, let's sync on the new UI specs.");
      expect(firstMsg.senderId._id ? firstMsg.senderId._id.toString() : firstMsg.senderId.toString()).toBe(employeeUser1._id.toString());
      expect(firstMsg.clientMessageId).toBe("client-uuid-001");

      const updatedConv = await Conversation.findById(conv._id);
      expect(updatedConv?.lastMessage?.body).toBe("Hello Charlie, let's sync on the new UI specs.");
      expect(updatedConv?.unreadCounts.get(employeeUser2._id.toString())).toBe(1);
      expect(updatedConv?.unreadCounts.get(employeeUser1._id.toString())).toBe(0);
    });

    it("should handle idempotent message retry with same clientMessageId without duplicating", async () => {
      const duplicateMsg = await communicationService.sendMessage(
        employeeUser1,
        conv._id.toString(),
        {
          body: "Hello Charlie, let's sync on the new UI specs.",
          clientMessageId: "client-uuid-001",
        }
      );

      expect(duplicateMsg._id.toString()).toBe(firstMsg._id.toString());

      const msgs = await Message.find({ conversationId: conv._id });
      expect(msgs).toHaveLength(1);
    });

    it("should prevent non-participant from sending messages into conversation", async () => {
      await expect(
        communicationService.sendMessage(
          employeeUser3,
          conv._id.toString(),
          { body: "Sneaking in message" }
        )
      ).rejects.toThrow("FORBIDDEN");
    });
  });

  describe("5. Listing Messages & Read Receipts", () => {
    let conv: any;

    beforeAll(async () => {
      conv = await communicationService.getOrCreateDirectConversation(
        employeeUser1,
        employeeUser2._id.toString()
      );

      await communicationService.sendMessage(
        employeeUser2,
        conv._id.toString(),
        { body: "Sounds good Bob, here are the specs." }
      );
    });

    it("should list messages in chronological order", async () => {
      const { items, total } = await communicationService.listMessages(
        employeeUser1,
        conv._id.toString()
      );

      expect(total).toBe(2);
      expect(items).toHaveLength(2);
      expect(items[0].body).toBe("Hello Charlie, let's sync on the new UI specs.");
      expect(items[1].body).toBe("Sounds good Bob, here are the specs.");
    });

    it("should mark conversation as read and reset recipient unread count", async () => {
      const result = await communicationService.markConversationRead(
        employeeUser1,
        conv._id.toString()
      );

      expect(result.success).toBe(true);

      const updatedConv = await Conversation.findById(conv._id);
      expect(updatedConv?.unreadCounts.get(employeeUser1._id.toString())).toBe(0);

      // Verify readBy on message
      const latestMsg = await Message.findOne({ conversationId: conv._id, body: "Sounds good Bob, here are the specs." });
      expect(latestMsg?.readBy.some((r: any) => r.userId.toString() === employeeUser1._id.toString())).toBe(true);
    });
  });

  describe("6. Message Edit and Deletion", () => {
    let conv: any;
    let msgToEdit: any;

    beforeAll(async () => {
      conv = await communicationService.getOrCreateDirectConversation(
        employeeUser1,
        employeeUser2._id.toString()
      );

      msgToEdit = await communicationService.sendMessage(
        employeeUser1,
        conv._id.toString(),
        { body: "Typo here: let meet at 3pm" }
      );
    });

    it("should allow author to edit their own message", async () => {
      const edited = await communicationService.editMessage(
        employeeUser1,
        msgToEdit._id.toString(),
        "Corrected: let's meet at 4pm"
      );

      expect(edited.body).toBe("Corrected: let's meet at 4pm");
      expect(edited.isEdited).toBe(true);
    });

    it("should prevent non-authors from editing messages", async () => {
      await expect(
        communicationService.editMessage(
          employeeUser2,
          msgToEdit._id.toString(),
          "Malicious edit"
        )
      ).rejects.toThrow("FORBIDDEN");
    });

    it("should soft-delete message and replace body with deleted notice", async () => {
      const result = await communicationService.deleteMessage(
        employeeUser1,
        msgToEdit._id.toString()
      );

      expect(result.success).toBe(true);

      const deletedMsg = await Message.findById(msgToEdit._id);
      expect(deletedMsg?.isDeleted).toBe(true);
      expect(deletedMsg?.body).toBe("This message was deleted");
    });
  });

  describe("7. Cross-Organization & Security Isolation", () => {
    it("should not allow users from another org to access conversations", async () => {
      const convList = await communicationService.listConversations(otherOrgUser);
      expect(convList.items).toHaveLength(0);
    });
  });
});
