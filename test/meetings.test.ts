import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Meeting from "../src/models/Meeting";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import * as meetingService from "../src/services/meetingService";

describe("Meetings & Calendar End-to-End Integration Tests", () => {
  let mongoServer: MongoMemoryServer;
  let testOrgId: mongoose.Types.ObjectId;
  let otherOrgId: mongoose.Types.ObjectId;
  let deptId: mongoose.Types.ObjectId;
  let teamId: mongoose.Types.ObjectId;
  let adminUser: any;
  let managerUser: any;
  let employeeUser1: any;
  let employeeUser2: any;
  let otherOrgUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Create Main Org
    const org = await Organization.create({
      name: "Meeting Test Org",
      slug: "meeting-test-org",
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

    // Create Admin User
    adminUser = await User.create({
      fullName: "Meeting Admin",
      email: "meetingadmin@test.com",
      employeeId: "ADM001",
      role: "ADMIN",
      organizationId: testOrgId,
      departmentId: deptId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create Manager User
    managerUser = await User.create({
      fullName: "Meeting Manager",
      email: "meetingmanager@test.com",
      employeeId: "MGR001",
      role: "MANAGER",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create Employee 1
    employeeUser1 = await User.create({
      fullName: "Invited Developer",
      email: "dev1@test.com",
      employeeId: "DEV001",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create Employee 2 (Not invited by default)
    employeeUser2 = await User.create({
      fullName: "Uninvited Designer",
      email: "des1@test.com",
      employeeId: "DES001",
      role: "DESIGNER",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create User from another Organization
    otherOrgUser = await User.create({
      fullName: "External Employee",
      email: "external@other.com",
      employeeId: "EXT001",
      role: "EMPLOYEE",
      organizationId: otherOrgId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("1. Meeting Scheduling & Initialization", () => {
    it("should successfully schedule a meeting with auto-generated code and organizer auto-accepted", async () => {
      const meetingDate = new Date("2026-09-15T09:00:00Z");
      const meeting = await meetingService.scheduleMeeting(managerUser, {
        title: "Sprint Planning Q3",
        description: "Review sprint goals and allocate user stories",
        date: meetingDate,
        startTime: "10:00 AM",
        endTime: "11:30 AM",
        meetingType: "ONLINE",
        meetingLink: "https://meet.google.com/abc-defg-hij",
        participants: [String(employeeUser1._id)],
      });

      expect(meeting).toBeDefined();
      expect(meeting.meetingId).toBe("MTG-0001");
      expect(meeting.title).toBe("Sprint Planning Q3");
      expect(meeting.status).toBe("SCHEDULED");
      expect(meeting.meetingType).toBe("ONLINE");
      expect(meeting.meetingLink).toBe("https://meet.google.com/abc-defg-hij");

      // Check participants: organizer should be ACCEPTED, employee should be PENDING
      expect(meeting.participants.length).toBe(2);
      const organizerParticipant = meeting.participants.find(
        (p: any) => String(p.userId) === String(managerUser._id)
      );
      expect(organizerParticipant).toBeDefined();
      expect(organizerParticipant.responseStatus).toBe("ACCEPTED");

      const devParticipant = meeting.participants.find(
        (p: any) => String(p.userId) === String(employeeUser1._id)
      );
      expect(devParticipant).toBeDefined();
      expect(devParticipant.responseStatus).toBe("PENDING");
    });

    it("should reject scheduling without title or organization context", async () => {
      await expect(
        meetingService.scheduleMeeting({ role: "EMPLOYEE" }, { title: "Test", date: new Date(), startTime: "10:00", endTime: "11:00" })
      ).rejects.toThrow("ORGANIZATION_ID_REQUIRED");

      await expect(
        meetingService.scheduleMeeting(managerUser, { title: "", date: new Date(), startTime: "10:00", endTime: "11:00" })
      ).rejects.toThrow("TITLE_REQUIRED");
    });

    it("should reject scheduling with participants from another organization", async () => {
      await expect(
        meetingService.scheduleMeeting(managerUser, {
          title: "Cross-org Leak Test",
          date: new Date("2026-09-16T10:00:00Z"),
          startTime: "02:00 PM",
          endTime: "03:00 PM",
          participants: [String(otherOrgUser._id)],
        })
      ).rejects.toThrow("INVALID_PARTICIPANT_ORGANIZATION");
    });
  });

  describe("2. Meeting Scoping, RBAC & Organization Isolation", () => {
    it("Admin / Manager should see all organization meetings", async () => {
      const { items, total } = await meetingService.listMeetings(adminUser, {});
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.some((m) => m.title === "Sprint Planning Q3")).toBe(true);
    });

    it("Employee 1 should only see meetings they are invited to or organized", async () => {
      const { items, total } = await meetingService.listMeetings(employeeUser1, {});
      expect(total).toBe(1);
      expect(items[0].title).toBe("Sprint Planning Q3");
    });

    it("Employee 2 should see 0 meetings when not invited", async () => {
      const { items, total } = await meetingService.listMeetings(employeeUser2, {});
      expect(total).toBe(0);
      expect(items.length).toBe(0);
    });

    it("External employee should see 0 meetings from test org", async () => {
      const { items, total } = await meetingService.listMeetings(otherOrgUser, {});
      expect(total).toBe(0);
      expect(items.length).toBe(0);
    });
  });

  describe("3. Calendar Integration & Date Range Filtering", () => {
    let sep10Meeting: any;
    let sep20Meeting: any;

    beforeAll(async () => {
      sep10Meeting = await meetingService.scheduleMeeting(managerUser, {
        title: "Design Review Early Sep",
        date: new Date("2026-09-10T14:00:00Z"),
        startTime: "02:00 PM",
        endTime: "03:00 PM",
      });

      sep20Meeting = await meetingService.scheduleMeeting(managerUser, {
        title: "Architecture Sync Late Sep",
        date: new Date("2026-09-20T16:00:00Z"),
        startTime: "04:00 PM",
        endTime: "05:00 PM",
      });
    });

    it("should filter meetings within a specific date range for calendar views", async () => {
      const rangeResult = await meetingService.listMeetings(
        adminUser,
        {},
        { startDate: "2026-09-08T00:00:00Z", endDate: "2026-09-12T23:59:59Z" }
      );

      expect(rangeResult.items.length).toBe(1);
      expect(rangeResult.items[0].title).toBe("Design Review Early Sep");
    });
  });

  describe("4. RSVP Workflow, Updates & Cancellation", () => {
    let testMeeting: any;

    beforeAll(async () => {
      testMeeting = await meetingService.scheduleMeeting(managerUser, {
        title: "Quarterly Roadmap Review",
        date: new Date("2026-09-25T10:00:00Z"),
        startTime: "10:00 AM",
        endTime: "11:00 AM",
        participants: [String(employeeUser1._id)],
      });
    });

    it("should allow invited employee to accept / update RSVP status", async () => {
      const updated = await meetingService.updateParticipantResponse(
        String(testMeeting._id),
        String(employeeUser1._id),
        "ACCEPTED"
      );

      const participant = updated.participants.find(
        (p: any) => String(p.userId) === String(employeeUser1._id)
      );
      expect(participant).toBeDefined();
      expect(participant.responseStatus).toBe("ACCEPTED");
    });

    it("should reject invalid RSVP status", async () => {
      await expect(
        meetingService.updateParticipantResponse(
          String(testMeeting._id),
          String(employeeUser1._id),
          "INVALID_STATUS"
        )
      ).rejects.toThrow("INVALID_RESPONSE_STATUS");
    });

    it("should allow manager to update meeting title, time, and link", async () => {
      const updated = await meetingService.updateMeeting(String(testMeeting._id), managerUser, {
        title: "Quarterly Roadmap & OKR Review",
        startTime: "10:30 AM",
        endTime: "12:00 PM",
        meetingLink: "https://zoom.us/j/999888777",
      });

      expect(updated.title).toBe("Quarterly Roadmap & OKR Review");
      expect(updated.startTime).toBe("10:30 AM");
      expect(updated.meetingLink).toBe("https://zoom.us/j/999888777");
    });

    it("should allow adding new participants with deduplication", async () => {
      const updated = await meetingService.addMeetingParticipants(
        String(testMeeting._id),
        [String(employeeUser2._id), String(employeeUser1._id)],
        managerUser
      );

      expect(updated.participants.length).toBe(3); // Organizer + Dev1 + Des1
      const desParticipant = updated.participants.find(
        (p: any) => String(p.userId) === String(employeeUser2._id)
      );
      expect(desParticipant).toBeDefined();
      expect(desParticipant.responseStatus).toBe("PENDING");
    });

    it("should allow removing a participant from the meeting", async () => {
      const updated = await meetingService.removeMeetingParticipant(
        String(testMeeting._id),
        String(employeeUser2._id),
        managerUser
      );

      expect(updated.participants.length).toBe(2);
      expect(updated.participants.some((p: any) => String(p.userId) === String(employeeUser2._id))).toBe(false);
    });

    it("should successfully cancel a meeting and prevent non-status modifications", async () => {
      const cancelled = await meetingService.cancelMeeting(
        String(testMeeting._id),
        managerUser,
        "Postponed to next month"
      );

      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.notes).toContain("Postponed to next month");

      // Attempting to update details of cancelled meeting should fail
      await expect(
        meetingService.updateMeeting(String(testMeeting._id), managerUser, {
          title: "Modifying Cancelled Meeting",
        })
      ).rejects.toThrow("CANNOT_MODIFY_CANCELLED_MEETING");
    });

    it("should prevent cross-organization user from accessing or updating meeting", async () => {
      await expect(
        meetingService.getMeetingById(String(testMeeting._id), otherOrgUser)
      ).rejects.toThrow("FORBIDDEN");

      await expect(
        meetingService.updateMeeting(String(testMeeting._id), otherOrgUser, { title: "Hacked" })
      ).rejects.toThrow("FORBIDDEN");
    });
  });
});
