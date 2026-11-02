import mongoose from "mongoose";
import Attendance from "../models/Attendance";
import AttendanceBreak from "../models/Break";
import DailyReport, { normalizeBlockers } from "../models/DailyReport";
import Task from "../models/Task";
import TaskTimeSession from "../models/TaskTimeSession";
import User from "../models/User";
import Team from "../models/Team";
import Department from "../models/Department";
import { createNotification, createBulkNotifications } from "./notificationService";
import { PointService } from "./pointService";
import { TargetService } from "./targetService";
import { PerformanceService } from "./performanceService";
import { PerformanceScoreService } from "./performanceScoreService";
import { recordAuditLog } from "./auditLogService";
import { canUserAssignWorkTo } from "../utils/scopeHelper";
import { emitTaskEvent } from "../realtime/task";
import { emitEODSubmitted, emitEODReviewed } from "../lib/socketEmitters";

const MS_PER_SECOND = 1000;

export const ROLE_ALLOWED_TASK_CATEGORIES: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  ADMIN: ["*"],
  MANAGER: ["*"],
  TEAM_LEADER: ["*"],
  SALES_EXECUTIVE: ["LEAD_FOLLOWUP", "CLIENT_CALL", "SALES_PITCH", "LEAD_UPDATE", "GENERAL"],
  DESIGNER: ["UI_DESIGN", "GRAPHICS", "WIREFRAME", "PROTOTYPE", "GENERAL"],
  DEVELOPER: ["BUG_FIX", "FEATURE_DEV", "CODE_REVIEW", "DEPLOYMENT", "GENERAL"],
  MARKETING: ["CAMPAIGN", "CONTENT_CREATION", "SOCIAL_MEDIA", "SEO", "GENERAL"],
  EMPLOYEE: ["DAILY_WORK", "TRAINING", "DOCUMENTATION", "GENERAL"],
  INTERN: ["DAILY_WORK", "TRAINING", "DOCUMENTATION", "GENERAL"],
};

export function isCategoryAllowedForRole(role: string, category: string): boolean {
  const allowed = ROLE_ALLOWED_TASK_CATEGORIES[role] || ROLE_ALLOWED_TASK_CATEGORIES["EMPLOYEE"];
  if (allowed.includes("*")) return true;
  return allowed.includes(category.toUpperCase());
}

export async function validateTaskAssignment(user: any, payload: any) {
  const isManagerOrAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role);
  const targetAssignedTo = payload.assignedTo || payload.assignedToId || (payload.teamId ? null : String(user._id));

  if (!isManagerOrAdmin) {
    if (String(targetAssignedTo) !== String(user._id)) {
      throw new Error("CANNOT_ASSIGN_TO_OTHERS");
    }
    if (payload.organizationId && String(payload.organizationId) !== String(user.organizationId)) {
      throw new Error("INVALID_ORGANIZATION");
    }
    const category = String(payload.category || "GENERAL").toUpperCase();
    if (!isCategoryAllowedForRole(user.role, category)) {
      throw new Error("ROLE_CATEGORY_NOT_ALLOWED");
    }
  } else {
    // Check management hierarchy & organizational scope
    const allowed = await canUserAssignWorkTo(user, {
      targetUserId: targetAssignedTo ? String(targetAssignedTo) : null,
      targetTeamId: payload.teamId ? String(payload.teamId) : null,
    });
    if (!allowed) {
      throw new Error("CANNOT_ASSIGN_OUTSIDE_SCOPE");
    }
  }

  // Ensure target user is active (not inactive, suspended, resigned, or terminated)
  if (targetAssignedTo) {
    const targetUserDoc = await User.findById(targetAssignedTo).select("status employmentStatus").lean();
    if (targetUserDoc) {
      const s = targetUserDoc.status || targetUserDoc.employmentStatus || "ACTIVE";
      if (["INACTIVE", "SUSPENDED", "RESIGNED", "TERMINATED"].includes(s)) {
        throw new Error("CANNOT_ASSIGN_TO_INACTIVE_USER");
      }
    }
  }
}

function startOfToday(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfToday(date = new Date()) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function getSessionSeconds(session: any, now = new Date()) {
  const startedAt = session?.resumedAt ? new Date(session.resumedAt) : new Date(session?.startedAt || now);
  const baseSeconds = Number(session?.activeSeconds || 0);
  if (session?.status === "ACTIVE") {
    const elapsedSeconds = Math.max(0, (now.getTime() - startedAt.getTime()) / MS_PER_SECOND);
    return Math.round(baseSeconds + elapsedSeconds);
  }
  return Math.round(baseSeconds);
}

function toMinutes(seconds: number) {
  return Math.max(0, Math.round(seconds / 60));
}

async function ensureAttendanceOnline(userId: string) {
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const attendance = await Attendance.findOne({ userId, date: { $gte: todayStart, $lte: todayEnd } }).lean();
  if (!attendance) throw new Error("ATTENDANCE_NOT_ACTIVE");
  if (attendance.currentStatus !== "ONLINE") throw new Error("ATTENDANCE_NOT_ACTIVE");
  const activeBreak = await AttendanceBreak.findOne({ userId, status: "ACTIVE" }).sort({ createdAt: -1 }).lean();
  if (activeBreak) throw new Error("ATTENDANCE_ON_BREAK");
  return attendance;
}

export async function createTask(payload: any) {
  const title = String(payload.title || "").trim();
  if (!title) throw new Error("TITLE_REQUIRED");

  const assignedTo = payload.assignedTo || payload.assignedToId;
  const assignedBy = payload.assignedBy || payload.assignedById || assignedTo;
  const createdBy = payload.createdBy || assignedBy;
  if (!assignedTo) throw new Error("ASSIGNED_TO_REQUIRED");

  const user = await User.findById(assignedTo).lean();
  if (!user) throw new Error("ASSIGNED_USER_NOT_FOUND");

  // Derive Team, Team Lead, and Manager hierarchy
  let resolvedTeamId = payload.teamId || user.teamId || null;
  let resolvedDepartmentId = payload.departmentId || user.departmentId || null;
  let resolvedTeamLeadId: any = null;
  let resolvedManagerId: any = null;

  if (resolvedTeamId) {
    const teamDoc = await Team.findById(resolvedTeamId).lean();
    if (teamDoc) {
      resolvedTeamLeadId = teamDoc.teamLeadId || null;
      resolvedManagerId = teamDoc.managerId || null;
      if (!resolvedDepartmentId) resolvedDepartmentId = teamDoc.departmentId || null;
    }
  }

  const taskId = payload.taskId || `TASK-${Date.now()}-${String(Math.random()).slice(2, 8)}`;
  const initialHistory = [
    {
      assignedTo,
      assignedBy,
      teamId: resolvedTeamId,
      managerId: resolvedManagerId,
      teamLeadId: resolvedTeamLeadId,
      reassignedAt: new Date(),
      reason: "Initial task assignment",
    },
  ];

  const created = await Task.create({
    taskId,
    title,
    description: payload.description || null,
    organizationId: payload.organizationId || user.organizationId,
    departmentId: resolvedDepartmentId,
    teamId: resolvedTeamId,
    managerId: resolvedManagerId,
    teamLeadId: resolvedTeamLeadId,
    projectId: payload.projectId || null,
    leadId: payload.leadId || null,
    contactId: payload.contactId || null,
    crmRecordId: payload.crmRecordId || null,
    assignedTo,
    assignedBy,
    createdBy,
    priority: payload.priority || "MEDIUM",
    category: payload.category || "GENERAL",
    status: payload.status || "ASSIGNED",
    startDate: payload.startDate ? new Date(payload.startDate) : null,
    dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
    estimatedMinutes: Number(payload.estimatedMinutes || 0),
    actualMinutes: Number(payload.actualMinutes || 0),
    creditPoints: Number(payload.creditPoints || 0),
    completionPercentage: Number(payload.completionPercentage || 0),
    completionNote: payload.completionNote || null,
    rejectionReason: payload.rejectionReason || null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    assignmentHistory: initialHistory,
    remarks: [],
  });

  const taskObject = created.toObject();

  // Audit Log
  await recordAuditLog({
    organizationId: String(taskObject.organizationId || user.organizationId || ""),
    actorId: String(assignedBy),
    action: "TASK_CREATED",
    entityType: "TASK",
    entityId: String(taskObject._id),
    summary: `Task "${title}" created and assigned to ${user.fullName}`,
    metadata: {
      taskId: taskObject.taskId,
      assignedTo: String(assignedTo),
      assignedBy: String(assignedBy),
      teamId: resolvedTeamId ? String(resolvedTeamId) : null,
      priority: taskObject.priority,
    },
  });

  await createNotification({
    recipientId: String(assignedTo),
    organizationId: String(taskObject.organizationId || user.organizationId || ""),
    type: "TASK_ASSIGNED",
    title: "New Task Assigned",
    message: `You have been assigned task: "${taskObject.title}"`,
    entityType: "TASK",
    entityId: String(taskObject._id),
    priority: (taskObject.priority === "URGENT" || taskObject.priority === "HIGH") ? "HIGH" : "NORMAL",
    dedupeKey: `TASK_ASSIGNED:${String(taskObject._id)}`,
  });

  emitTaskEvent("task:created", taskObject, {
    organizationId: taskObject.organizationId ? String(taskObject.organizationId) : null,
    teamId: taskObject.teamId ? String(taskObject.teamId) : null,
    userId: String(assignedTo),
  });

  return taskObject;
}

export async function getTaskById(id: string) {
  return Task.findById(id)
    .populate("assignedTo", "fullName email employeeId designation role departmentId teamId")
    .populate("assignedBy", "fullName email employeeId designation role")
    .populate("reviewedBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .populate("departmentId", "name code")
    .lean();
}

export async function listTasks(filter: Record<string, unknown> = {}, opts: Record<string, any> = {}) {
  const { skip = 0, limit = 50, sort = { createdAt: -1 } } = opts;
  const items = await Task.find(filter)
    .populate("assignedTo", "fullName email employeeId designation role departmentId teamId")
    .populate("assignedBy", "fullName email employeeId designation role")
    .populate("reviewedBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .populate("departmentId", "name code")
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();
  const total = await Task.countDocuments(filter);
  return { items, total, page: Math.floor(skip / limit) + 1, limit };
}

export async function updateTask(id: string, payload: any) {
  const existing: any = await Task.findById(id).lean();
  if (!existing) throw new Error("TASK_NOT_FOUND");

  const update: Record<string, any> = { ...payload };
  if (update.dueDate) update.dueDate = new Date(update.dueDate);
  if (update.startDate) update.startDate = new Date(update.startDate);
  if (update.title !== undefined) update.title = String(update.title).trim();
  if (update.title && !update.title) throw new Error("TITLE_REQUIRED");
  if (update.estimatedMinutes !== undefined) update.estimatedMinutes = Number(update.estimatedMinutes || 0);
  if (update.actualMinutes !== undefined) update.actualMinutes = Number(update.actualMinutes || 0);
  if (update.creditPoints !== undefined) update.creditPoints = Number(update.creditPoints || 0);
  if (update.completionPercentage !== undefined) update.completionPercentage = Number(update.completionPercentage || 0);

  // Handle reassignment history
  if (payload.assignedTo && String(payload.assignedTo) !== String(existing.assignedTo)) {
    const newAssignee = await User.findById(payload.assignedTo).lean();
    if (!newAssignee) throw new Error("ASSIGNED_USER_NOT_FOUND");

    const historyEntry = {
      assignedTo: payload.assignedTo,
      assignedBy: payload.assignedBy || existing.assignedBy,
      teamId: payload.teamId || newAssignee.teamId || existing.teamId || null,
      reassignedAt: new Date(),
      reason: payload.reassignmentReason || payload.reason || "Task reassigned",
    };

    update.$push = { ...(update.$push || {}), assignmentHistory: historyEntry };
    update.teamId = payload.teamId || newAssignee.teamId || existing.teamId;
    update.departmentId = newAssignee.departmentId || existing.departmentId;
  }

  // Handle remarks addition
  if (payload.remark || payload.comment) {
    const remarkEntry = {
      userId: payload.remarkUserId || payload.assignedBy,
      userName: payload.remarkUserName || "User",
      userRole: payload.remarkUserRole || "EMPLOYEE",
      comment: String(payload.remark || payload.comment),
      createdAt: new Date(),
    };
    update.$push = { ...(update.$push || {}), remarks: remarkEntry };
  }

  const updated = await Task.findByIdAndUpdate(id, update, { new: true })
    .populate("assignedTo", "fullName email employeeId designation role")
    .populate("assignedBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .lean();

  const isReassigned = payload.assignedTo && String(payload.assignedTo) !== String(existing.assignedTo);
  if (isReassigned && updated) {
    const newAssigneeId = String((updated.assignedTo as any)?._id || updated.assignedTo);
    await createNotification({
      recipientId: newAssigneeId,
      organizationId: String(updated.organizationId || existing.organizationId || ""),
      type: "TASK_ASSIGNED",
      title: "Task Reassigned to You",
      message: `Task "${updated.title}" has been reassigned to you.`,
      entityType: "TASK",
      entityId: String(updated._id),
      priority: "HIGH",
      dedupeKey: `TASK_REASSIGNED:${String(updated._id)}:${Date.now()}`,
    });
  }

  if (updated) {
    emitTaskEvent("task:updated", updated, {
      organizationId: updated.organizationId ? String(updated.organizationId) : null,
      teamId: updated.teamId ? String(updated.teamId) : null,
      userId: String((updated.assignedTo as any)?._id || updated.assignedTo),
    });
  }

  return updated;
}

export async function startTaskTimer(taskId: string, userId: string) {
  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");
  if (String(task.assignedTo) !== String(userId)) throw new Error("FORBIDDEN");

  await ensureAttendanceOnline(userId);

  const existingActive = await TaskTimeSession.findOne({ userId, status: "ACTIVE" }).sort({ createdAt: -1 }).lean();
  if (existingActive) {
    throw new Error("ACTIVE_TASK_TIMER_EXISTS");
  }

  const session = await TaskTimeSession.create({
    taskId,
    userId,
    startedAt: new Date(),
    pausedAt: null,
    resumedAt: new Date(),
    endedAt: null,
    activeSeconds: 0,
    status: "ACTIVE",
  });

  const updatedTask = await Task.findByIdAndUpdate(
    taskId,
    { status: "IN_PROGRESS", startDate: task.startDate || new Date(), completionPercentage: Math.max(Number(task.completionPercentage || 0), 5) },
    { new: true }
  ).lean();

  return { task: updatedTask, session };
}

export async function pauseTaskTimer(taskId: string, userId: string) {
  const session = await TaskTimeSession.findOne({ taskId, userId, status: "ACTIVE" }).sort({ createdAt: -1 }).lean();
  if (!session) throw new Error("NO_ACTIVE_TASK_TIMER");

  const now = new Date();
  const sessionSeconds = getSessionSeconds(session, now);

  const updatedSession = await TaskTimeSession.findByIdAndUpdate(
    session._id,
    {
      pausedAt: now,
      status: "PAUSED",
      activeSeconds: sessionSeconds,
    },
    { new: true }
  ).lean();

  const updatedTask = await Task.findByIdAndUpdate(taskId, { status: "PAUSED" }, { new: true }).lean();
  return { task: updatedTask, session: updatedSession };
}

export async function resumeTaskTimer(taskId: string, userId: string) {
  const session = await TaskTimeSession.findOne({ taskId, userId, status: "PAUSED" }).sort({ createdAt: -1 }).lean();
  if (!session) throw new Error("NO_PAUSED_TASK_TIMER");

  await ensureAttendanceOnline(userId);
  const now = new Date();
  const updatedSession = await TaskTimeSession.findByIdAndUpdate(
    session._id,
    {
      resumedAt: now,
      status: "ACTIVE",
      pausedAt: null,
    },
    { new: true }
  ).lean();

  const updatedTask = await Task.findByIdAndUpdate(taskId, { status: "IN_PROGRESS" }, { new: true }).lean();
  return { task: updatedTask, session: updatedSession };
}

export async function completeTaskTimer(taskId: string, userId: string) {
  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");
  const session = await TaskTimeSession.findOne({ taskId, userId, status: { $in: ["ACTIVE", "PAUSED"] } }).sort({ createdAt: -1 }).lean();
  if (!session) throw new Error("NO_TASK_TIMER");

  const finalSeconds = getSessionSeconds(session, new Date());
  const finalMinutes = toMinutes(finalSeconds);

  await TaskTimeSession.findByIdAndUpdate(
    session._id,
    {
      activeSeconds: finalSeconds,
      status: "COMPLETED",
      endedAt: new Date(),
      pausedAt: session.status === "PAUSED" ? session.pausedAt : null,
    },
    { new: true }
  );

  const updatedTask = await Task.findByIdAndUpdate(
    taskId,
    {
      status: "COMPLETED",
      actualMinutes: Math.max(Number(task.actualMinutes || 0), finalMinutes),
      completionPercentage: 100,
      completedAt: new Date(),
    },
    { new: true }
  ).lean();

  return { task: updatedTask, totalMinutes: finalMinutes };
}

export async function submitTask(taskId: string, userId: string, payload: any = {}) {
  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");
  if (String(task.assignedTo) !== String(userId)) throw new Error("FORBIDDEN");

  const summary = await completeTaskTimer(taskId, userId);
  const finalTask = await Task.findByIdAndUpdate(
    taskId,
    {
      status: "REVIEW",
      completionNote: payload.completionNote || task.completionNote || null,
      submittedAt: new Date(),
      completionPercentage: 100,
      actualMinutes: Math.max(Number(task.actualMinutes || 0), Number(summary.totalMinutes || 0)),
    },
    { new: true }
  ).lean();

  const reviewerId = task.assignedBy ? String(task.assignedBy) : null;
  if (reviewerId && reviewerId !== String(userId)) {
    await createNotification({
      recipientId: reviewerId,
      organizationId: String(task.organizationId || ""),
      type: "TASK_SUBMITTED",
      title: "Task Submitted for Review",
      message: `Task "${task.title}" has been submitted for review.`,
      entityType: "TASK",
      entityId: String(taskId),
      priority: "HIGH",
      dedupeKey: `TASK_SUBMITTED:${String(taskId)}`,
    });
  }

  if (finalTask) {
    emitTaskEvent("task:submitted", finalTask, {
      organizationId: finalTask.organizationId ? String(finalTask.organizationId) : null,
      teamId: finalTask.teamId ? String(finalTask.teamId) : null,
      userId: reviewerId,
    });
    emitTaskEvent("task:status_changed", finalTask, {
      organizationId: finalTask.organizationId ? String(finalTask.organizationId) : null,
      teamId: finalTask.teamId ? String(finalTask.teamId) : null,
      userId: String(userId),
    });
  }

  return { task: finalTask, totalMinutes: summary.totalMinutes };
}

export async function approveTask(taskId: string, actorUser?: any) {
  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");

  if (actorUser) {
    const isSuper = actorUser.role === "SUPER_ADMIN";
    const isAdmin = actorUser.role === "ADMIN" && String(task.organizationId) === String(actorUser.organizationId);
    if (!isSuper && !isAdmin) {
      const allowed = await canUserAssignWorkTo(actorUser, {
        targetUserId: String(task.assignedTo),
        targetTeamId: task.teamId ? String(task.teamId) : null,
      });
      if (!allowed && String(task.assignedBy) !== String(actorUser._id)) {
        throw new Error("UNAUTHORIZED_TASK_REVIEW");
      }
    }
  }

  // Check if already approved (deduplication)
  if (task.approvedAt) {
    throw new Error("TASK_ALREADY_APPROVED");
  }

  const updatedTask = await Task.findByIdAndUpdate(
    taskId,
    {
      status: "COMPLETED",
      approvedAt: new Date(),
      rejectionReason: null,
      reviewedBy: actorUser ? actorUser._id : null,
      reviewedAt: new Date(),
    },
    { new: true }
  ).lean();

  if (updatedTask) {
    // Award points for task approval
    try {
      const isAlreadyAwarded = await PointService.isPointsAlreadyAwarded(
        String(task.assignedTo),
        String(task.organizationId),
        "TASK",
        taskId
      );

      if (!isAlreadyAwarded) {
        await PointService.awardPoints(
          String(task.assignedTo),
          String(task.organizationId),
          "TASK_APPROVED",
          taskId,
          actorUser ? actorUser._id : undefined,
          Number(task.creditPoints || 0)
        );
      }

      // Update task targets
      await TargetService.updateTargetsForCompletedTask(String(task.assignedTo), String(task.organizationId));

      // Regenerate performance snapshot & emit performance:updated
      await PerformanceScoreService.createDailyPerformanceSnapshot(
        String(task.assignedTo),
        String(task.organizationId),
        new Date(),
        true
      );
    } catch (error) {
      console.error("Error awarding points/performance for task approval:", error);
    }

    await createNotification({
      recipientId: String(task.assignedTo),
      organizationId: String(task.organizationId || ""),
      type: "TASK_APPROVED",
      title: "Task Approved",
      message: `Task approved: "${task.title}".`,
      entityType: "TASK",
      entityId: String(taskId),
      priority: "NORMAL",
      dedupeKey: `TASK_APPROVED:${String(taskId)}`,
    });

    emitTaskEvent("task:approved", updatedTask, {
      organizationId: updatedTask.organizationId ? String(updatedTask.organizationId) : null,
      teamId: updatedTask.teamId ? String(updatedTask.teamId) : null,
      userId: String(task.assignedTo),
    });
    emitTaskEvent("task:status_changed", updatedTask, {
      organizationId: updatedTask.organizationId ? String(updatedTask.organizationId) : null,
      teamId: updatedTask.teamId ? String(updatedTask.teamId) : null,
      userId: String(task.assignedTo),
    });
  }

  return updatedTask;
}

export async function rejectTask(taskId: string, reason?: string, actorUser?: any) {
  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");

  if (actorUser) {
    const isSuper = actorUser.role === "SUPER_ADMIN";
    const isAdmin = actorUser.role === "ADMIN" && String(task.organizationId) === String(actorUser.organizationId);
    if (!isSuper && !isAdmin) {
      const allowed = await canUserAssignWorkTo(actorUser, {
        targetUserId: String(task.assignedTo),
        targetTeamId: task.teamId ? String(task.teamId) : null,
      });
      if (!allowed && String(task.assignedBy) !== String(actorUser._id)) {
        throw new Error("UNAUTHORIZED_TASK_REVIEW");
      }
    }
  }

  const updatedTask = await Task.findByIdAndUpdate(
    taskId,
    {
      status: "REWORK",
      rejectionReason: reason || "Task rejected for revision",
      reviewedBy: actorUser ? actorUser._id : null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    },
    { new: true }
  ).lean();

  if (updatedTask) {
    await createNotification({
      recipientId: String(task.assignedTo),
      organizationId: String(task.organizationId || ""),
      type: "TASK_REJECTED",
      title: "Task Rejected for Rework",
      message: `Task "${task.title}" requires rework: ${reason || "Task rejected for revision"}`,
      entityType: "TASK",
      entityId: String(taskId),
      priority: "HIGH",
      dedupeKey: `TASK_REJECTED:${String(taskId)}`,
    });

    emitTaskEvent("task:rejected", updatedTask, {
      organizationId: updatedTask.organizationId ? String(updatedTask.organizationId) : null,
      teamId: updatedTask.teamId ? String(updatedTask.teamId) : null,
      userId: String(task.assignedTo),
    });
    emitTaskEvent("task:status_changed", updatedTask, {
      organizationId: updatedTask.organizationId ? String(updatedTask.organizationId) : null,
      teamId: updatedTask.teamId ? String(updatedTask.teamId) : null,
      userId: String(task.assignedTo),
    });

    try {
      await PerformanceScoreService.createDailyPerformanceSnapshot(
        String(task.assignedTo),
        String(task.organizationId),
        new Date(),
        true
      );
    } catch (e) {
      console.error("Error updating performance snapshot on task rejection:", e);
    }
  }

  return updatedTask;
}

export async function cancelTask(taskId: string, actorUser?: any) {
  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");

  if (actorUser) {
    const isSuper = actorUser.role === "SUPER_ADMIN";
    const isAdmin = actorUser.role === "ADMIN" && String(task.organizationId) === String(actorUser.organizationId);
    if (!isSuper && !isAdmin) {
      const allowed = await canUserAssignWorkTo(actorUser, {
        targetUserId: String(task.assignedTo),
        targetTeamId: task.teamId ? String(task.teamId) : null,
      });
      if (!allowed && String(task.assignedBy) !== String(actorUser._id)) {
        throw new Error("UNAUTHORIZED_TASK_CANCEL");
      }
    }
  }

  const updatedTask = await Task.findByIdAndUpdate(
    taskId,
    { status: "CANCELLED", cancelledAt: new Date() },
    { new: true }
  ).lean();

  return updatedTask;
}

export async function getTodayWorkSummary(userId: string) {
  const start = startOfToday();
  const end = endOfToday();

  const [sessions, tasks, attendance] = await Promise.all([
    TaskTimeSession.find({ userId, createdAt: { $gte: start, $lte: end } }).lean(),
    Task.find({ assignedTo: userId, createdAt: { $gte: start, $lte: end } }).lean(),
    Attendance.findOne({ userId, date: { $gte: start, $lte: end } }).lean(),
  ]);

  const totalTrackedMinutes = sessions.reduce((sum, session) => sum + toMinutes(getSessionSeconds(session)), 0);
  const completedTasks = tasks.filter((task) => task.status === "COMPLETED").length;
  const submittedTasks = tasks.filter((task) => task.status === "REVIEW").length;
  const approvedTasks = tasks.filter((task) => task.approvedAt != null).length;
  const reworkTasks = tasks.filter((task) => task.status === "REWORK").length;
  const pendingTasks = tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status)).length;
  const overdueTasks = tasks.filter((task) => {
    if (["COMPLETED", "CANCELLED"].includes(task.status)) return false;
    if (!task.dueDate) return false;
    return new Date(task.dueDate) < new Date();
  }).length;
  const carriedForwardTasks = tasks.filter((task) => ["PAUSED", "TODO", "ASSIGNED"].includes(task.status)).length;

  const attendanceDurationMinutes = attendance ? Math.round(Number(attendance.totalWorkDuration || 0) / 60000) : 0;
  const breakDurationMinutes = attendance ? Math.round(Number(attendance.totalBreakDuration || 0) / 60000) : 0;

  return {
    totalTrackedMinutes,
    taskWorkedMinutes: totalTrackedMinutes,
    totalTasks: tasks.length,
    taskCount: tasks.length,
    tasksAssigned: tasks.length,
    completedTasks,
    tasksCompleted: completedTasks,
    submittedTasks,
    tasksSubmitted: submittedTasks,
    approvedTasks,
    tasksApproved: approvedTasks,
    reworkTasks,
    tasksRework: reworkTasks,
    pendingTasks,
    tasksPending: pendingTasks,
    overdueTasks,
    tasksOverdue: overdueTasks,
    carriedForwardTasks,
    tasksCarriedForward: carriedForwardTasks,
    attendanceMinutes: attendanceDurationMinutes,
    breakMinutes: breakDurationMinutes,
    attendanceStatus: attendance?.attendanceStatus || (attendance?.currentStatus === "ONLINE" ? "PRESENT" : "UNKNOWN"),
    checkInTime: attendance?.firstLoginAt || null,
    checkOutTime: attendance?.lastLogoutAt || null,
    sessions: sessions.map((session) => ({
      taskId: String(session.taskId),
      status: session.status,
      trackedMinutes: toMinutes(getSessionSeconds(session)),
    })),
    taskList: tasks.map((t) => ({
      taskId: t.taskId,
      title: t.title,
      status: t.status,
      priority: t.priority,
    })),
  };
}

export async function updateDailyReport(userId: string, payload: any = {}) {
  const today = startOfToday();
  const summaryText = String(payload.summary || payload.completedSummary || "").trim();
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("USER_NOT_FOUND");

  let resolvedTeamId: any = user.teamId || null;
  let resolvedDepartmentId: any = user.departmentId || null;
  let resolvedTeamLeadId: any = null;
  let resolvedManagerId: any = null;

  if (resolvedTeamId) {
    const teamDoc = await Team.findById(resolvedTeamId).lean();
    if (teamDoc) {
      resolvedTeamLeadId = teamDoc.teamLeadId || null;
      resolvedManagerId = teamDoc.managerId || null;
      if (!resolvedDepartmentId) resolvedDepartmentId = teamDoc.departmentId || null;
    }
  }

  const workSummary = await getTodayWorkSummary(userId);
  const nextStatus = payload.status === "APPROVED"
    ? "APPROVED"
    : payload.status === "REWORK_REQUIRED"
      ? "REWORK_REQUIRED"
      : payload.status === "SUBMITTED"
        ? "SUBMITTED"
        : payload.status || "DRAFT";

  // Calculate daily performance score preview
  let performanceScore = 0;
  try {
    const scoreResult = await PerformanceService.calculatePerformanceScore(
      userId,
      String(user.organizationId),
      today,
      endOfToday()
    );
    performanceScore = Math.round(scoreResult.performanceScore || 0);
  } catch (err) {
    performanceScore = 0;
  }

  const formattedBlockers = normalizeBlockers(payload.blockers);
  const completedTasksCount =
    typeof payload.completedTasks === "number"
      ? payload.completedTasks
      : workSummary.completedTasks;
  const completedSummaryText = payload.completedSummary
    ? String(payload.completedSummary).trim()
    : Array.isArray(payload.completedTasks) && payload.completedTasks.length > 0
      ? payload.completedTasks.join("; ")
      : summaryText || null;

  const report = await DailyReport.findOneAndUpdate(
    { userId, reportDate: today },
    {
      userId,
      organizationId: user.organizationId || null,
      departmentId: resolvedDepartmentId,
      teamId: resolvedTeamId,
      managerId: resolvedManagerId,
      teamLeadId: resolvedTeamLeadId,
      reportDate: today,
      summary: summaryText || null,
      completedSummary: completedSummaryText,
      highlights: Array.isArray(payload.highlights) ? payload.highlights : [],
      blockers: formattedBlockers,
      blockerCount: formattedBlockers.length,
      plannedTasks: Array.isArray(payload.plannedTasks) ? payload.plannedTasks : [],
      completedTasks: completedTasksCount,
      achievements: Array.isArray(payload.achievements) ? payload.achievements : [],
      additionalWork: payload.additionalWork ? String(payload.additionalWork).trim() : null,
      tomorrowPriority: payload.tomorrowPriority ? String(payload.tomorrowPriority).trim() : null,
      totalTasksWorked: workSummary.totalTasks,
      totalTasksAssigned: workSummary.totalTasks,
      totalTasksCompleted: workSummary.completedTasks,
      tasksAssigned: workSummary.totalTasks,
      tasksCompleted: workSummary.completedTasks,
      tasksSubmitted: workSummary.submittedTasks,
      tasksApproved: workSummary.approvedTasks,
      tasksRework: workSummary.reworkTasks,
      tasksPending: workSummary.pendingTasks,
      tasksOverdue: workSummary.overdueTasks,
      tasksCarriedForward: workSummary.carriedForwardTasks,
      totalWorkedMinutes: workSummary.totalTrackedMinutes,
      taskWorkedMinutes: workSummary.totalTrackedMinutes,
      attendanceMinutes: workSummary.attendanceMinutes,
      breakMinutes: workSummary.breakMinutes,
      attendanceStatus: workSummary.attendanceStatus,
      checkInTime: workSummary.checkInTime,
      checkOutTime: workSummary.checkOutTime,
      performanceScore,
      status: nextStatus,
      submittedAt: nextStatus === "SUBMITTED" ? (payload.submittedAt || new Date()) : null,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return report;
}

export async function createDailyReport(userId: string, payload: any = {}) {
  const summaryText = String(payload.summary || payload.completedSummary || "").trim();
  if (!summaryText) throw new Error("SUMMARY_REQUIRED");

  return updateDailyReport(userId, payload);
}

export async function submitDailyReport(userId: string, payload: any = {}) {
  const summaryText = String(payload.summary || payload.completedSummary || "").trim();
  if (!summaryText) throw new Error("SUMMARY_REQUIRED");

  const report = await updateDailyReport(userId, { ...payload, status: "SUBMITTED", submittedAt: new Date() });

  const user = await User.findById(userId).lean();
  if (user && report) {
    // Notify Team Lead or Manager
    let reviewerId: string | null = null;
    if (report.teamLeadId && String(report.teamLeadId) !== String(userId)) {
      reviewerId = String(report.teamLeadId);
    } else if (report.managerId && String(report.managerId) !== String(userId)) {
      reviewerId = String(report.managerId);
    }

    if (reviewerId) {
      await createNotification({
        recipientId: reviewerId,
        organizationId: String(report.organizationId || ""),
        type: "EOD_REPORT_SUBMITTED",
        title: "Daily Work Report Submitted",
        message: `${user.fullName} submitted today's Daily Work Report for review.`,
        entityType: "DAILY_REPORT",
        entityId: String(report._id),
        priority: "HIGH",
        dedupeKey: `EOD_REPORT_SUBMITTED:${String(report._id)}`,
      });
    }

    // Award points (idempotent: exactly once per daily report)
    try {
      await PointService.awardPoints(
        userId,
        String(report.organizationId),
        "DAILY_REPORT_SUBMITTED",
        report._id,
        userId
      );
    } catch (err) {
      console.error("Failed to award EOD points:", err);
    }

    // Regenerate daily performance snapshot
    try {
      await PerformanceScoreService.createDailyPerformanceSnapshot(
        String(userId),
        String(report.organizationId),
        report.reportDate,
        true
      );
    } catch (err) {
      console.error("Failed to regenerate performance snapshot on daily report submission:", err);
    }

    // Emit real-time socket event
    emitEODSubmitted(
      userId,
      report,
      String(report.organizationId),
      report.teamId ? String(report.teamId) : null,
      report.managerId ? String(report.managerId) : null,
      report.teamLeadId ? String(report.teamLeadId) : null
    );

    await recordAuditLog({
      organizationId: String(report.organizationId || ""),
      actorId: String(userId),
      actorRole: user.role,
      action: "DAILY_REPORT_SUBMITTED",
      entityType: "DAILY_REPORT",
      entityId: String(report._id),
      summary: `Daily work report submitted by ${user.fullName}`,
      metadata: {
        reportDate: report.reportDate,
        tasksCompleted: report.tasksCompleted,
        totalWorkedMinutes: report.totalWorkedMinutes,
      },
    });
  }

  return report;
}

export async function reviewDailyReportById(
  reportId: string,
  actorUser: any,
  payload: { status: "APPROVED" | "REWORK_REQUIRED" | "REVIEWED"; reviewerRemarks?: string; reworkReason?: string }
) {
  const report: any = await DailyReport.findById(reportId).lean();
  if (!report) throw new Error("REPORT_NOT_FOUND");

  // Prevent self-approval
  if (String(report.userId) === String(actorUser._id || actorUser.id)) {
    throw new Error("CANNOT_REVIEW_OWN_REPORT");
  }

  // Hierarchy validation
  const isSuper = actorUser.role === "SUPER_ADMIN";
  const isAdmin = actorUser.role === "ADMIN" && String(report.organizationId) === String(actorUser.organizationId);

  if (!isSuper && !isAdmin) {
    const allowed = await canUserAssignWorkTo(actorUser, {
      targetUserId: String(report.userId),
      targetTeamId: report.teamId ? String(report.teamId) : null,
    });
    if (!allowed) {
      throw new Error("FORBIDDEN");
    }
  }

  const isApproval = payload.status === "APPROVED" || payload.status === "REVIEWED";
  const nextStatus = isApproval ? "APPROVED" : "REWORK_REQUIRED";

  const updated = await DailyReport.findByIdAndUpdate(
    reportId,
    {
      status: nextStatus,
      reviewedBy: actorUser._id || actorUser.id,
      reviewedAt: new Date(),
      reviewerRemarks: payload.reviewerRemarks || null,
      reworkReason: isApproval ? null : (payload.reworkReason || "Report requires revision"),
    },
    { new: true }
  ).lean();

  // Regenerate daily performance snapshot upon approval or rework
  try {
    await PerformanceScoreService.createDailyPerformanceSnapshot(
      String(report.userId),
      String(report.organizationId),
      report.reportDate,
      true
    );
  } catch (err) {
    console.error("Error creating performance snapshot upon daily report review:", err);
  }

  emitEODReviewed(
    String(report.userId),
    updated,
    String(report.organizationId),
    report.teamId ? String(report.teamId) : null,
    String(actorUser._id || actorUser.id)
  );

  if (isApproval) {
    await createNotification({
      recipientId: String(report.userId),
      organizationId: String(report.organizationId || ""),
      type: "TASK_APPROVED",
      title: "Daily Work Report Approved",
      message: `Your Daily Work Report for ${new Date(report.reportDate).toLocaleDateString()} has been approved.`,
      entityType: "DAILY_REPORT",
      entityId: reportId,
      priority: "NORMAL",
      dedupeKey: `EOD_REPORT_APPROVED:${reportId}`,
    });

    await recordAuditLog({
      organizationId: String(report.organizationId || ""),
      actorId: String(actorUser._id || actorUser.id),
      actorRole: actorUser.role,
      action: "DAILY_REPORT_APPROVED",
      entityType: "DAILY_REPORT",
      entityId: reportId,
      summary: `Daily work report approved for ${report.userId}`,
      metadata: { reviewerRemarks: payload.reviewerRemarks },
    });
  } else {
    await createNotification({
      recipientId: String(report.userId),
      organizationId: String(report.organizationId || ""),
      type: "TASK_REJECTED",
      title: "Daily Report Rework Required",
      message: `Your Daily Work Report requires rework: ${payload.reworkReason || "Please update your report."}`,
      entityType: "DAILY_REPORT",
      entityId: reportId,
      priority: "HIGH",
      dedupeKey: `EOD_REPORT_REWORK:${reportId}`,
    });

    await recordAuditLog({
      organizationId: String(report.organizationId || ""),
      actorId: String(actorUser._id || actorUser.id),
      actorRole: actorUser.role,
      action: "DAILY_REPORT_REWORK_REQUESTED",
      entityType: "DAILY_REPORT",
      entityId: reportId,
      summary: `Daily work report sent back for rework to ${report.userId}`,
      metadata: { reworkReason: payload.reworkReason },
    });
  }

  return updated;
}

export async function getDailyReport(userId: string, reportDate?: string) {
  const targetDate = reportDate ? startOfToday(new Date(reportDate)) : startOfToday();
  return DailyReport.findOne({ userId, reportDate: targetDate })
    .populate("userId", "fullName email employeeId designation role")
    .populate("reviewedBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .lean();
}

export async function listDailyReports(filter: Record<string, unknown> = {}, opts: Record<string, any> = {}) {
  const { skip = 0, limit = 20, sort = { reportDate: -1 } } = opts;
  const items = await DailyReport.find(filter)
    .populate("userId", "fullName email employeeId designation role")
    .populate("reviewedBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();
  const total = await DailyReport.countDocuments(filter);
  return { items, total, page: Math.floor(skip / limit) + 1, limit };
}

export async function reassignTask(taskId: string, newAssigneeId: string, actorUser: any, reason?: string) {
  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");

  const isSuper = actorUser.role === "SUPER_ADMIN";
  const isAdmin = actorUser.role === "ADMIN" && String(task.organizationId) === String(actorUser.organizationId);

  if (!isSuper && !isAdmin) {
    const allowed = await canUserAssignWorkTo(actorUser, {
      targetUserId: newAssigneeId,
    });
    if (!allowed) {
      throw new Error("CANNOT_ASSIGN_OUTSIDE_SCOPE");
    }
  }

  const newAssignee = await User.findById(newAssigneeId).lean();
  if (!newAssignee) throw new Error("ASSIGNED_USER_NOT_FOUND");

  let resolvedTeamId: any = newAssignee.teamId || null;
  let resolvedDepartmentId: any = newAssignee.departmentId || null;
  let resolvedTeamLeadId: any = null;
  let resolvedManagerId: any = null;

  if (resolvedTeamId) {
    const teamDoc = await Team.findById(resolvedTeamId).lean();
    if (teamDoc) {
      resolvedTeamLeadId = teamDoc.teamLeadId || null;
      resolvedManagerId = teamDoc.managerId || null;
      if (!resolvedDepartmentId) resolvedDepartmentId = teamDoc.departmentId || null;
    }
  }

  const historyEntry = {
    assignedTo: newAssigneeId,
    assignedBy: actorUser._id || actorUser.id,
    teamId: resolvedTeamId,
    managerId: resolvedManagerId,
    teamLeadId: resolvedTeamLeadId,
    reassignedAt: new Date(),
    reason: reason || "Task reassigned",
  };

  const updated = await Task.findByIdAndUpdate(
    taskId,
    {
      assignedTo: newAssigneeId,
      assignedBy: actorUser._id || actorUser.id,
      teamId: resolvedTeamId,
      departmentId: resolvedDepartmentId,
      managerId: resolvedManagerId,
      teamLeadId: resolvedTeamLeadId,
      $push: { assignmentHistory: historyEntry },
    },
    { new: true }
  )
    .populate("assignedTo", "fullName email employeeId designation role")
    .populate("assignedBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .lean();

  await recordAuditLog({
    organizationId: String(task.organizationId || actorUser.organizationId || ""),
    actorId: String(actorUser._id || actorUser.id),
    actorRole: actorUser.role,
    action: "TASK_REASSIGNED",
    entityType: "TASK",
    entityId: taskId,
    summary: `Task "${task.title}" reassigned to ${newAssignee.fullName}`,
    metadata: {
      taskId: task.taskId,
      previousAssignee: String(task.assignedTo),
      newAssignee: newAssigneeId,
      changedBy: String(actorUser._id || actorUser.id),
      reason: reason || null,
    },
  });

  await createNotification({
    recipientId: newAssigneeId,
    organizationId: String(task.organizationId || ""),
    type: "TASK_ASSIGNED",
    title: "Task Reassigned to You",
    message: `Task "${task.title}" has been reassigned to you by ${actorUser.fullName || "Leadership"}.${reason ? ` Reason: ${reason}` : ""}`,
    entityType: "TASK",
    entityId: String(taskId),
    priority: "HIGH",
    dedupeKey: `TASK_REASSIGNED:${String(taskId)}:${Date.now()}`,
  });

  return updated;
}

export async function addCommentToTask(taskId: string, comment: string, actorUser: any) {
  const text = String(comment || "").trim();
  if (!text) throw new Error("COMMENT_REQUIRED");

  const task = await Task.findById(taskId).lean();
  if (!task) throw new Error("TASK_NOT_FOUND");

  const remarkEntry = {
    userId: actorUser._id || actorUser.id,
    userName: actorUser.fullName || "User",
    userRole: actorUser.role || "EMPLOYEE",
    comment: text,
    createdAt: new Date(),
  };

  const updated = await Task.findByIdAndUpdate(
    taskId,
    {
      $push: { remarks: remarkEntry },
    },
    { new: true }
  )
    .populate("assignedTo", "fullName email employeeId designation role")
    .populate("assignedBy", "fullName email employeeId designation role")
    .lean();

  await recordAuditLog({
    organizationId: String(task.organizationId || actorUser.organizationId || ""),
    actorId: String(actorUser._id || actorUser.id),
    actorRole: actorUser.role,
    action: "TASK_COMMENT_ADDED",
    entityType: "TASK",
    entityId: taskId,
    summary: `Comment added on task "${task.title}" by ${actorUser.fullName || actorUser.role}`,
    metadata: {
      taskId: task.taskId,
      comment: text,
    },
  });

  const actorId = String(actorUser._id || actorUser.id);
  const notifyRecipients = [String(task.assignedTo), String(task.assignedBy)].filter((id) => id && id !== actorId);

  for (const recipientId of notifyRecipients) {
    await createNotification({
      recipientId,
      organizationId: String(task.organizationId || ""),
      type: "TASK_UPDATED",
      title: "New Task Comment",
      message: `${actorUser.fullName || "Team member"} commented on "${task.title}": ${text.length > 60 ? text.substring(0, 57) + "..." : text}`,
      entityType: "TASK",
      entityId: String(taskId),
      priority: "NORMAL",
      dedupeKey: `TASK_COMMENT:${String(taskId)}:${Date.now()}`,
    }).catch(() => {});
  }

  return updated;
}

export async function getTaskTimeline(taskId: string, actorUser?: any) {
  const task = await Task.findById(taskId)
    .populate("assignedTo", "fullName email employeeId designation role")
    .populate("assignedBy", "fullName email employeeId designation role")
    .populate("reviewedBy", "fullName email employeeId designation role")
    .populate("createdBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .populate("assignmentHistory.assignedTo", "fullName email employeeId")
    .populate("assignmentHistory.assignedBy", "fullName email employeeId")
    .lean();

  if (!task) throw new Error("TASK_NOT_FOUND");

  const sessions = await TaskTimeSession.find({ taskId }).sort({ createdAt: 1 }).lean();

  const events: Array<{
    type: string;
    title: string;
    actor?: string | null;
    timestamp: Date;
    details?: any;
  }> = [];

  events.push({
    type: "TASK_CREATED",
    title: "Task Created",
    actor: (task.createdBy as any)?.fullName || (task.assignedBy as any)?.fullName || "System",
    timestamp: task.createdAt,
    details: { initialAssignee: (task.assignedTo as any)?.fullName, priority: task.priority },
  });

  if (Array.isArray(task.assignmentHistory)) {
    for (const h of task.assignmentHistory) {
      events.push({
        type: "TASK_ASSIGNMENT",
        title: "Task Assigned / Reassigned",
        actor: (h.assignedBy as any)?.fullName || "Leadership",
        timestamp: h.reassignedAt,
        details: {
          assignedTo: (h.assignedTo as any)?.fullName,
          reason: h.reason,
        },
      });
    }
  }

  for (const s of sessions) {
    events.push({
      type: "TIMER_STARTED",
      title: "Work Session Started",
      actor: (task.assignedTo as any)?.fullName,
      timestamp: s.startedAt,
      details: { status: s.status, activeSeconds: s.activeSeconds },
    });
    if (s.pausedAt) {
      events.push({
        type: "TIMER_PAUSED",
        title: "Work Session Paused",
        actor: (task.assignedTo as any)?.fullName,
        timestamp: s.pausedAt,
      });
    }
    if (s.endedAt) {
      events.push({
        type: "TIMER_COMPLETED",
        title: "Work Session Completed",
        actor: (task.assignedTo as any)?.fullName,
        timestamp: s.endedAt,
        details: { activeMinutes: Math.round((s.activeSeconds || 0) / 60) },
      });
    }
  }

  if (task.submittedAt) {
    events.push({
      type: "TASK_SUBMITTED",
      title: "Task Submitted for Review",
      actor: (task.assignedTo as any)?.fullName,
      timestamp: task.submittedAt,
      details: { note: task.completionNote },
    });
  }

  if (task.approvedAt) {
    events.push({
      type: "TASK_APPROVED",
      title: "Task Approved",
      actor: (task.reviewedBy as any)?.fullName || "Reviewer",
      timestamp: task.approvedAt,
    });
  } else if (task.rejectionReason) {
    events.push({
      type: "TASK_REJECTED",
      title: "Task Rejected for Rework",
      actor: (task.reviewedBy as any)?.fullName || "Reviewer",
      timestamp: task.reviewedAt || task.updatedAt,
      details: { reason: task.rejectionReason },
    });
  }

  if (Array.isArray(task.remarks)) {
    for (const r of task.remarks) {
      events.push({
        type: "COMMENT_ADDED",
        title: "Comment Added",
        actor: r.userName || "User",
        timestamp: r.createdAt,
        details: { comment: r.comment, role: r.userRole },
      });
    }
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return { task, timeline: events };
}
