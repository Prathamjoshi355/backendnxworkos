import mongoose from "mongoose";
import Leave from "../models/Leave";
import LeaveType from "../models/LeaveType";
import User from "../models/User";
import { createNotification } from "./notificationService";
import { recordAuditLog } from "./auditLogService";
import { getManagementScope } from "../utils/scopeHelper";
import { emitLeaveEvent } from "../realtime/leave";
import { emitAttendanceEvent } from "../realtime/attendance";

export async function createLeaveType(organizationId: string, payload: any) {
  const existing = await LeaveType.findOne({ organizationId, code: payload.code.toUpperCase() }).lean();
  if (existing) throw new Error("LEAVE_TYPE_EXISTS");
  const created = await LeaveType.create({
    ...payload,
    code: payload.code.toUpperCase(),
    organizationId,
  });
  return created.toObject();
}

export async function listLeaveTypes(organizationId: string) {
  const items = await LeaveType.find({ organizationId, status: "ACTIVE" }).lean();
  if (items.length === 0) {
    // Seed default leave types if none exist
    const defaults = [
      { name: "Casual Leave", code: "CL", allocatedDays: 12, isPaid: true },
      { name: "Sick Leave", code: "SL", allocatedDays: 10, isPaid: true },
      { name: "Earned Leave", code: "EL", allocatedDays: 15, isPaid: true },
      { name: "Unpaid Leave", code: "UL", allocatedDays: 30, isPaid: false, allowNegativeBalance: true },
    ];
    const created = await LeaveType.insertMany(defaults.map((d) => ({ ...d, organizationId })));
    return created.map((c) => c.toObject());
  }
  return items;
}

export async function applyLeave(user: any, payload: any) {
  const startDate = new Date(payload.startDate);
  const endDate = new Date(payload.endDate);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error("INVALID_DATES");
  }
  if (endDate < startDate) {
    throw new Error("END_DATE_BEFORE_START_DATE");
  }

  // Calculate inclusive calendar days
  const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
  const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  const userId = user._id || user.id;
  const organizationId = user.organizationId;

  // Prevent overlapping active leaves
  const overlap = await Leave.findOne({
    userId,
    status: { $in: ["PENDING", "APPROVED"] },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  }).lean();

  if (overlap) {
    throw new Error("LEAVE_OVERLAP");
  }

  // Resolve Leave Type details if leaveTypeId provided
  let resolvedLeaveTypeId = payload.leaveTypeId || null;
  let resolvedLeaveTypeName = payload.leaveTypeName || "General Leave";

  if (resolvedLeaveTypeId && mongoose.isValidObjectId(resolvedLeaveTypeId)) {
    const leaveTypeDoc = await LeaveType.findOne({ _id: resolvedLeaveTypeId, organizationId }).lean();
    if (leaveTypeDoc) {
      resolvedLeaveTypeName = leaveTypeDoc.name;
      if (!leaveTypeDoc.allowNegativeBalance) {
        const balanceList = await getLeaveBalance(String(userId), String(organizationId));
        const currentBal = balanceList.find((b) => String(b.leaveTypeId) === String(leaveTypeDoc._id));
        if (currentBal && currentBal.remaining < totalDays) {
          throw new Error("INSUFFICIENT_LEAVE_BALANCE");
        }
      }
    }
  }

  const leave = await Leave.create({
    userId,
    organizationId,
    departmentId: user.departmentId || null,
    teamId: user.teamId || null,
    leaveTypeId: resolvedLeaveTypeId,
    leaveTypeName: resolvedLeaveTypeName,
    startDate,
    endDate,
    totalDays,
    reason: payload.reason,
    status: "PENDING",
  });

  // Notify Admin / Reporting Manager
  await createNotification({
    recipientId: String(user.reportingManagerId || organizationId),
    organizationId: String(organizationId),
    title: "New Leave Application",
    message: `${user.fullName} applied for ${totalDays} day(s) leave (${resolvedLeaveTypeName}).`,
    type: "LEAVE",
    entityId: String(leave._id),
  }).catch(() => {});

  emitLeaveEvent("leave:created", leave, {
    organizationId: String(organizationId),
    teamId: user.teamId ? String(user.teamId) : null,
    userId: String(userId),
    reportingManagerId: user.reportingManagerId ? String(user.reportingManagerId) : null,
  });

  return leave.toObject();
}

export async function listLeaves(filter: Record<string, unknown>, opts: { skip?: number; limit?: number } = {}) {
  const skip = opts.skip || 0;
  const limit = opts.limit || 20;

  const items = await Leave.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("userId", "fullName email employeeId role departmentId teamId")
    .populate("reviewedBy", "fullName email")
    .lean();

  const total = await Leave.countDocuments(filter);
  return { items, total };
}

export async function getLeaveById(leaveId: string, user: any) {
  const leave = await Leave.findById(leaveId)
    .populate("userId", "fullName email employeeId role departmentId teamId")
    .populate("reviewedBy", "fullName email")
    .lean();

  if (!leave) throw new Error("LEAVE_NOT_FOUND");

  // Multi-tenant check
  if (user.role !== "SUPER_ADMIN" && String(leave.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // Employee ownership check
  if (user.role === "EMPLOYEE" || user.role === "INTERN" || user.role === "DESIGNER" || user.role === "SALES_EXECUTIVE" || user.role === "DEVELOPER" || user.role === "MARKETING" || user.role === "HR") {
    const leaveUserId = (leave.userId as any)?._id || leave.userId;
    if (String(leaveUserId) !== String(user._id || user.id)) {
      throw new Error("FORBIDDEN");
    }
  }

  return leave;
}

export async function reviewLeave(leaveId: string, status: "APPROVED" | "REJECTED", reviewer: any, comment?: string) {
  const leave = await Leave.findById(leaveId);
  if (!leave) throw new Error("LEAVE_NOT_FOUND");

  const reviewerId = String(reviewer._id || reviewer.id);
  const leaveUserId = String(leave.userId);

  // Self-approval protection: Employees, Team Leads, Managers cannot approve their own leaves
  if (leaveUserId === reviewerId) {
    throw new Error("CANNOT_APPROVE_OWN_LEAVE");
  }

  // Multi-tenant check
  if (reviewer.role !== "SUPER_ADMIN" && String(leave.organizationId) !== String(reviewer.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // Hierarchical scope check
  if (reviewer.role === "MANAGER" || reviewer.role === "TEAM_LEADER") {
    const scope = await getManagementScope(reviewer);
    if (!scope.scopedUserIds.includes(leaveUserId)) {
      throw new Error("LEAVE_USER_OUTSIDE_SCOPE");
    }
  } else if (reviewer.role !== "SUPER_ADMIN" && reviewer.role !== "ADMIN") {
    throw new Error("FORBIDDEN");
  }

  if (leave.status !== "PENDING") throw new Error("LEAVE_ALREADY_PROCESSED");

  leave.status = status;
  leave.reviewedAt = new Date();
  leave.reviewedBy = reviewer._id || reviewer.id;
  leave.reviewerComment = comment || null;
  await leave.save();

  // Attendance Integration: Mark calendar dates as ON_LEAVE upon approval
  if (status === "APPROVED") {
    try {
      const Attendance = (await import("../models/Attendance")).default;
      const currentDay = new Date(leave.startDate);
      const endDay = new Date(leave.endDate);

      while (currentDay <= endDay) {
        const dayStart = new Date(currentDay);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(currentDay);
        dayEnd.setHours(23, 59, 59, 999);

        const existingAtt = await Attendance.findOne({
          userId: leave.userId,
          date: { $gte: dayStart, $lte: dayEnd },
        });

        if (!existingAtt) {
          await Attendance.create({
            userId: leave.userId,
            organizationId: leave.organizationId,
            departmentId: leave.departmentId || null,
            teamId: leave.teamId || null,
            date: dayStart,
            attendanceStatus: "ON_LEAVE",
            currentStatus: "OFFLINE",
            totalWorkDuration: 0,
            totalBreakDuration: 0,
          });
        } else if (existingAtt.currentStatus === "OFFLINE" && existingAtt.totalWorkDuration === 0) {
          existingAtt.attendanceStatus = "ON_LEAVE";
          await existingAtt.save();
        }

        currentDay.setDate(currentDay.getDate() + 1);
      }
    } catch (attErr) {
      console.error("Failed to sync approved leave with attendance:", attErr);
    }
  }

  // Notify Employee
  await createNotification({
    recipientId: String(leave.userId),
    organizationId: String(leave.organizationId),
    title: `Leave Application ${status}`,
    message: `Your leave application for ${leave.totalDays} day(s) was ${status.toLowerCase()}.${comment ? ` Note: ${comment}` : ""}`,
    type: "LEAVE",
    entityId: String(leave._id),
  }).catch(() => {});

  await recordAuditLog({
    organizationId: String(leave.organizationId),
    actorId: reviewerId,
    actorRole: reviewer.role,
    action: status === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
    entityType: "LEAVE",
    entityId: leaveId,
    summary: `${status} leave for user ${leave.userId}`,
    metadata: {
      leaveId,
      targetUserId: leaveUserId,
      status,
      reviewerComment: comment || null,
    },
  });

  emitLeaveEvent(status === "APPROVED" ? "leave:approved" : "leave:rejected", leave, {
    organizationId: String(leave.organizationId),
    teamId: leave.teamId ? String(leave.teamId) : null,
    userId: String(leave.userId),
  });

  if (status === "APPROVED") {
    emitAttendanceEvent("attendance:updated", { userId: String(leave.userId), status: "ON_LEAVE" }, {
      organizationId: String(leave.organizationId),
      teamId: leave.teamId ? String(leave.teamId) : null,
      userId: String(leave.userId),
    });
  }

  return leave.toObject();
}

export async function cancelLeave(leaveId: string, user: any) {
  const leave = await Leave.findById(leaveId);
  if (!leave) throw new Error("LEAVE_NOT_FOUND");

  const userId = String(user._id || user.id);
  const isOwner = String(leave.userId) === userId;
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  if (!isOwner && !isAdmin) {
    throw new Error("UNAUTHORIZED_CANCEL");
  }

  if (isAdmin && user.role !== "SUPER_ADMIN" && String(leave.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // An employee can cancel PENDING or future APPROVED leaves
  if (leave.status !== "PENDING" && leave.status !== "APPROVED") {
    throw new Error("CANNOT_CANCEL_PROCESSED_LEAVE");
  }

  const previousStatus = leave.status;
  leave.status = "CANCELLED";
  await leave.save();

  // If previous status was APPROVED, revert Attendance status if not checked in
  if (previousStatus === "APPROVED") {
    try {
      const Attendance = (await import("../models/Attendance")).default;
      const currentDay = new Date(leave.startDate);
      const endDay = new Date(leave.endDate);

      while (currentDay <= endDay) {
        const dayStart = new Date(currentDay);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(currentDay);
        dayEnd.setHours(23, 59, 59, 999);

        const existingAtt = await Attendance.findOne({
          userId: leave.userId,
          date: { $gte: dayStart, $lte: dayEnd },
        });

        if (existingAtt && existingAtt.attendanceStatus === "ON_LEAVE" && existingAtt.currentStatus === "OFFLINE") {
          existingAtt.attendanceStatus = "ABSENT";
          await existingAtt.save();
        }

        currentDay.setDate(currentDay.getDate() + 1);
      }
    } catch (attErr) {
      console.error("Failed to revert attendance for cancelled leave:", attErr);
    }
  }

  await recordAuditLog({
    organizationId: String(leave.organizationId),
    actorId: userId,
    actorRole: user.role,
    action: "LEAVE_CANCELLED",
    entityType: "LEAVE",
    entityId: leaveId,
    summary: `Cancelled leave ${leaveId}`,
    metadata: {
      leaveId,
      targetUserId: String(leave.userId),
      previousStatus,
    },
  });

  emitLeaveEvent("leave:cancelled", leave, {
    organizationId: String(leave.organizationId),
    teamId: leave.teamId ? String(leave.teamId) : null,
    userId: String(leave.userId),
  });

  if (previousStatus === "APPROVED") {
    emitAttendanceEvent("attendance:updated", { userId: String(leave.userId), status: "ABSENT" }, {
      organizationId: String(leave.organizationId),
      teamId: leave.teamId ? String(leave.teamId) : null,
      userId: String(leave.userId),
    });
  }

  return leave.toObject();
}

export async function getLeaveBalance(userId: string, organizationId: string) {
  const types = await listLeaveTypes(organizationId);
  const approvedLeaves = await Leave.find({ userId, status: "APPROVED" }).lean();
  const pendingLeaves = await Leave.find({ userId, status: "PENDING" }).lean();

  const balanceList = types.map((type) => {
    const usedDays = approvedLeaves
      .filter((l) => String(l.leaveTypeName).toLowerCase() === String(type.name).toLowerCase() || String(l.leaveTypeId) === String(type._id))
      .reduce((sum, l) => sum + (l.totalDays || 0), 0);

    const pendingDays = pendingLeaves
      .filter((l) => String(l.leaveTypeName).toLowerCase() === String(type.name).toLowerCase() || String(l.leaveTypeId) === String(type._id))
      .reduce((sum, l) => sum + (l.totalDays || 0), 0);

    const remainingDays = type.allocatedDays - usedDays;

    return {
      leaveTypeId: String(type._id),
      leaveTypeName: type.name,
      allocated: type.allocatedDays,
      used: usedDays,
      pending: pendingDays,
      remaining: Math.max(0, remainingDays),
      isPaid: type.isPaid,
      allowNegativeBalance: type.allowNegativeBalance,
    };
  });

  return balanceList;
}

export async function getLeaveAnalytics(user: any) {
  const query: Record<string, unknown> = {};

  if (user.role === "SUPER_ADMIN") {
    if (user.organizationId) query.organizationId = user.organizationId;
  } else if (user.role === "ADMIN") {
    query.organizationId = user.organizationId;
    if (user.departmentId) query.departmentId = user.departmentId;
  } else {
    query.organizationId = user.organizationId;
    query.userId = user._id || user.id;
  }

  const [total, pending, approved, rejected, cancelled, leavesList] = await Promise.all([
    Leave.countDocuments(query),
    Leave.countDocuments({ ...query, status: "PENDING" }),
    Leave.countDocuments({ ...query, status: "APPROVED" }),
    Leave.countDocuments({ ...query, status: "REJECTED" }),
    Leave.countDocuments({ ...query, status: "CANCELLED" }),
    Leave.find(query).lean(),
  ]);

  const totalDaysApproved = leavesList.filter((l) => l.status === "APPROVED").reduce((sum, l) => sum + (l.totalDays || 0), 0);
  const totalDaysPending = leavesList.filter((l) => l.status === "PENDING").reduce((sum, l) => sum + (l.totalDays || 0), 0);

  return {
    total,
    pending,
    approved,
    rejected,
    cancelled,
    totalDaysApproved,
    totalDaysPending,
  };
}
