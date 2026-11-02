import http from "http";
import jwt from "jsonwebtoken";
import { initSocket, getSocket } from "../src/lib/socket";
import { emitAttendanceEvent, buildAttendanceSocketPayload } from "../src/realtime/attendance";
import { emitTaskEvent } from "../src/realtime/task";
import { emitLeadEvent } from "../src/realtime/crm";
import { emitLeaveEvent } from "../src/realtime/leave";
import { emitPointsUpdated, emitPerformanceUpdated, emitTargetUpdated, emitTargetAchieved } from "../src/lib/socketEmitters";

const JWT_SECRET = process.env.JWT_SECRET || "nexisparkx-jwt-secret-key-2026";

describe("Socket.IO Realtime Engine Unit & Integration Tests", () => {
  let server: http.Server;
  let io: any;

  beforeAll(() => {
    server = http.createServer();
    io = initSocket(server);
  });

  test("getSocket returns initialized socket server", () => {
    expect(getSocket()).toBeDefined();
    expect(getSocket()).toBe(io);
  });

  test("buildAttendanceSocketPayload normalizes attendance state correctly", () => {
    const user = {
      _id: "u-101",
      employeeId: "EMP001",
      fullName: "Alice Developer",
      employmentType: "EMPLOYEE",
      role: "DEVELOPER",
      organizationId: "org-1",
      departmentId: "dept-1",
      teamId: "team-1",
    };

    const payload = buildAttendanceSocketPayload(user, "ONLINE");

    expect(payload.userId).toBe("u-101");
    expect(payload.fullName).toBe("Alice Developer");
    expect(payload.status).toBe("ONLINE");
    expect(payload.organizationId).toBe("org-1");
    expect(payload.timestamp).toBeDefined();
  });

  test("emitAttendanceEvent dispatches to scoped rooms and broadcast without errors", () => {
    const emitSpy = jest.spyOn(io, "emit").mockImplementation(() => true as any);
    const toSpy = jest.spyOn(io, "to").mockReturnValue({ emit: jest.fn() } as any);

    emitAttendanceEvent(
      "attendance:updated",
      { userId: "u-101", status: "ONLINE" },
      { organizationId: "org-1", teamId: "team-1", userId: "u-101" }
    );

    expect(toSpy).toHaveBeenCalledWith("org:org-1");
    expect(toSpy).toHaveBeenCalledWith("team:team-1");
    expect(toSpy).toHaveBeenCalledWith("user:u-101");
    expect(emitSpy).toHaveBeenCalledWith("attendance:updated", { userId: "u-101", status: "ONLINE" });

    emitSpy.mockRestore();
    toSpy.mockRestore();
  });

  test("emitTaskEvent dispatches task lifecycle events to scoped rooms", () => {
    const toSpy = jest.spyOn(io, "to").mockReturnValue({ emit: jest.fn() } as any);
    const emitSpy = jest.spyOn(io, "emit").mockImplementation(() => true as any);

    emitTaskEvent(
      "task:created",
      {
        taskId: "TASK-100",
        title: "Build Realtime Sockets",
        assignedTo: "u-102",
        assignedBy: "admin-1",
        status: "ASSIGNED",
        priority: "HIGH",
        organizationId: "org-1",
      },
      { organizationId: "org-1", userId: "u-102" }
    );

    expect(toSpy).toHaveBeenCalledWith("org:org-1");
    expect(toSpy).toHaveBeenCalledWith("user:u-102");
    expect(emitSpy).toHaveBeenCalledWith(
      "task:created",
      expect.objectContaining({
        taskId: "TASK-100",
        title: "Build Realtime Sockets",
        status: "ASSIGNED",
      })
    );

    toSpy.mockRestore();
    emitSpy.mockRestore();
  });

  test("emitLeadEvent dispatches CRM events with timestamp", () => {
    const emitSpy = jest.spyOn(io, "emit").mockImplementation(() => true as any);

    emitLeadEvent("lead:created", {
      leadId: "lead-1",
      name: "Acme Corp",
      status: "NEW",
    });

    expect(emitSpy).toHaveBeenCalledWith(
      "lead:created",
      expect.objectContaining({
        leadId: "lead-1",
        name: "Acme Corp",
        timestamp: expect.any(String),
      })
    );

    emitSpy.mockRestore();
  });

  test("emitPointsUpdated, emitPerformanceUpdated, and emitTargetUpdated dispatch to user rooms", () => {
    const toSpy = jest.spyOn(io, "to").mockReturnValue({ emit: jest.fn() } as any);

    emitPointsUpdated("u-103", {
      points: 50,
      type: "EARNED",
      sourceType: "TASK",
      reason: "Task Approved",
      createdAt: new Date(),
    } as any);

    expect(toSpy).toHaveBeenCalledWith("user:u-103");

    emitPerformanceUpdated("u-103", {
      performanceScore: 92,
      taskCompletionScore: 95,
      timelinessScore: 90,
      attendanceScore: 100,
      targetScore: 85,
      consistencyScore: 90,
      productivityScore: 92,
      periodType: "WEEKLY",
      calculatedAt: new Date(),
    } as any);

    expect(toSpy).toHaveBeenCalledWith("user:u-103");

    emitTargetUpdated("u-103", {
      _id: "t-1",
      title: "Monthly Target",
      currentValue: 8,
      targetValue: 10,
      status: "IN_PROGRESS",
    } as any);

    expect(toSpy).toHaveBeenCalledWith("user:u-103");

    emitTargetAchieved("u-103", {
      _id: "t-1",
      title: "Monthly Target",
    } as any);

    expect(toSpy).toHaveBeenCalledWith("user:u-103");

    toSpy.mockRestore();
  });

  test("emitLeaveEvent dispatches leave events to user, org, and manager rooms", () => {
    const toSpy = jest.spyOn(io, "to").mockReturnValue({ emit: jest.fn() } as any);
    const emitSpy = jest.spyOn(io, "emit").mockImplementation(() => true as any);

    emitLeaveEvent(
      "leave:created",
      {
        _id: "leave-1",
        userId: "u-104",
        userName: "John Developer",
        leaveTypeName: "Casual Leave",
        startDate: new Date("2026-09-01"),
        endDate: new Date("2026-09-03"),
        totalDays: 3,
        reason: "Family event",
        status: "PENDING",
        organizationId: "org-1",
        teamId: "team-1",
      },
      {
        organizationId: "org-1",
        teamId: "team-1",
        userId: "u-104",
        reportingManagerId: "mgr-1",
      }
    );

    expect(toSpy).toHaveBeenCalledWith("org:org-1");
    expect(toSpy).toHaveBeenCalledWith("team:team-1");
    expect(toSpy).toHaveBeenCalledWith("user:u-104");
    expect(toSpy).toHaveBeenCalledWith("user:mgr-1");
    expect(emitSpy).toHaveBeenCalledWith(
      "leave:created",
      expect.objectContaining({
        leaveId: "leave-1",
        userId: "u-104",
        status: "PENDING",
      })
    );

    toSpy.mockRestore();
    emitSpy.mockRestore();
  });
});
