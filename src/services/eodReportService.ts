import mongoose from "mongoose";
import DailyReport, { IDailyReport, IEODBlocker, DailyReportStatus, normalizeBlockers } from "../models/DailyReport";
import Task, { ITask } from "../models/Task";
import TaskTimeSession from "../models/TaskTimeSession";
import Attendance from "../models/Attendance";
import User from "../models/User";
import Team from "../models/Team";
import Department from "../models/Department";
import { createNotification } from "./notificationService";
import { recordAuditLog } from "./auditLogService";
import { getManagementScope } from "../utils/scopeHelper";
import { PerformanceScoreService } from "./performanceScoreService";
import { PointService } from "./pointService";
import { emitEODSubmitted, emitEODReviewed, emitEODUpdated } from "../lib/socketEmitters";

export interface IAuthoritativeDayTaskData {
  totalWorkedMinutes: number;
  taskWorkedMinutes: number;
  attendanceMinutes: number;
  breakMinutes: number;
  attendanceStatus: string;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  totalTasksWorked: number;
  completedTasks: number;
  pendingTasks: number;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksSubmitted: number;
  tasksApproved: number;
  tasksRework: number;
  tasksPending: number;
  tasksOverdue: number;
  tasksCarriedForward: number;
  completedTaskIds: string[];
  inProgressTaskIds: string[];
  pendingTaskIds: string[];
  tasks: any[];
}

export function startOfDay(d: Date = new Date()): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(d: Date = new Date()): Date {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

function generateReportId(date: Date, counter: number): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `EOD-${yyyy}${mm}${dd}-${randomSuffix}`;
}

export async function resolveUserHierarchy(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("USER_NOT_FOUND");

  let organizationId = user.organizationId ? String(user.organizationId) : "";
  let departmentId = user.departmentId ? String(user.departmentId) : null;
  let teamId = user.teamId ? String(user.teamId) : null;
  let managerId: string | null = user.reportingManagerId ? String(user.reportingManagerId) : null;
  let teamLeadId: string | null = null;

  if (teamId) {
    const teamDoc = await Team.findById(teamId).lean();
    if (teamDoc) {
      if (!departmentId && teamDoc.departmentId) departmentId = String(teamDoc.departmentId);
      if (teamDoc.managerId) managerId = String(teamDoc.managerId);
      if (teamDoc.teamLeadId) teamLeadId = String(teamDoc.teamLeadId);
      if (!organizationId && teamDoc.organizationId) organizationId = String(teamDoc.organizationId);
    }
  }

  if (departmentId && !organizationId) {
    const deptDoc = await Department.findById(departmentId).lean();
    if (deptDoc?.organizationId) organizationId = String(deptDoc.organizationId);
  }

  return {
    user,
    organizationId,
    departmentId,
    teamId,
    managerId,
    teamLeadId,
  };
}

export async function getAuthoritativeDayTaskData(userId: string, date: Date = new Date()): Promise<IAuthoritativeDayTaskData> {
  const start = startOfDay(date);
  const end = endOfDay(date);

  const [tasks, sessions, attendance] = await Promise.all([
    Task.find({
      assignedTo: userId,
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { updatedAt: { $gte: start, $lte: end } },
        { completedAt: { $gte: start, $lte: end } },
        { status: { $in: ["IN_PROGRESS", "TODO", "ASSIGNED", "PAUSED", "REVIEW", "REWORK"] } },
      ],
    }).lean(),
    TaskTimeSession.find({
      userId,
      startedAt: { $gte: start, $lte: end },
    }).lean(),
    Attendance.findOne({
      userId,
      date: { $gte: start, $lte: end },
    }).lean(),
  ]);

  let totalSessionSeconds = 0;
  for (const session of sessions) {
    totalSessionSeconds += Number((session as any).activeSeconds || 0);
    if ((session as any).status === "ACTIVE" && (session as any).startedAt) {
      totalSessionSeconds += Math.floor((Date.now() - new Date((session as any).startedAt).getTime()) / 1000);
    }
  }
  const taskWorkedMinutes = Math.round(totalSessionSeconds / 60);

  const attendanceMinutes = attendance ? Math.round(Number(attendance.totalWorkDuration || 0) / 60000) : 0;
  const breakMinutes = attendance ? Math.round(Number(attendance.totalBreakDuration || 0) / 60000) : 0;
  const totalWorkedMinutes = Math.max(taskWorkedMinutes, attendanceMinutes);

  const completedTaskIds: string[] = [];
  const inProgressTaskIds: string[] = [];
  const pendingTaskIds: string[] = [];

  let completedTasks = 0;
  let tasksSubmitted = 0;
  let tasksApproved = 0;
  let tasksRework = 0;
  let tasksPending = 0;
  let tasksOverdue = 0;
  let tasksCarriedForward = 0;

  for (const t of tasks) {
    const tId = String(t._id);
    if (t.status === "COMPLETED") {
      completedTasks++;
      tasksApproved++;
      completedTaskIds.push(tId);
    } else if (t.status === "REVIEW") {
      tasksSubmitted++;
      inProgressTaskIds.push(tId);
    } else if (t.status === "REWORK") {
      tasksRework++;
      inProgressTaskIds.push(tId);
    } else if (t.status === "IN_PROGRESS") {
      inProgressTaskIds.push(tId);
      tasksPending++;
    } else {
      pendingTaskIds.push(tId);
      tasksPending++;
      tasksCarriedForward++;
    }

    if (t.dueDate && new Date(t.dueDate) < new Date() && !["COMPLETED", "CANCELLED"].includes(t.status)) {
      tasksOverdue++;
    }
  }

  return {
    totalWorkedMinutes,
    taskWorkedMinutes,
    attendanceMinutes,
    breakMinutes,
    attendanceStatus: attendance?.attendanceStatus || (attendance?.currentStatus === "ONLINE" ? "PRESENT" : "OFFLINE"),
    checkInTime: attendance?.firstLoginAt || null,
    checkOutTime: attendance?.lastLogoutAt || null,
    totalTasksWorked: tasks.length,
    completedTasks,
    pendingTasks: tasksPending,
    tasksAssigned: tasks.length,
    tasksCompleted: completedTasks,
    tasksSubmitted,
    tasksApproved,
    tasksRework,
    tasksPending,
    tasksOverdue,
    tasksCarriedForward,
    completedTaskIds,
    inProgressTaskIds,
    pendingTaskIds,
    tasks: tasks.map((t) => ({
      id: String(t._id),
      taskId: t.taskId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      completionPercentage: t.completionPercentage || 0,
      dueDate: t.dueDate,
    })),
  };
}

export async function createOrUpdateEODReport(userId: string, payload: any = {}) {
  const targetDate = payload.reportDate ? new Date(payload.reportDate) : new Date();
  const start = startOfDay(targetDate);
  const end = endOfDay(targetDate);

  const hierarchy = await resolveUserHierarchy(userId);
  const authoritativeTaskData = await getAuthoritativeDayTaskData(userId, targetDate);

  let existing = await DailyReport.findOne({
    userId,
    reportDate: { $gte: start, $lte: end },
  });

  if (existing && ["APPROVED", "LOCKED"].includes(existing.status)) {
    throw new Error("CANNOT_MODIFY_APPROVED_REPORT");
  }

  // Parse blockers using canonical normalization
  const blockersList: IEODBlocker[] = normalizeBlockers(payload.blockers);

  const isSubmitting = payload.action === "SUBMIT" || payload.status === "SUBMITTED";

  const nextStatus: DailyReportStatus = isSubmitting
    ? "SUBMITTED"
    : (payload.status === "RETURNED" || payload.status === "REWORK_REQUIRED")
    ? "RETURNED"
    : "DRAFT";

  // Calculate live day performance preview
  let performanceScore = 0;
  try {
    const scoreResult = await PerformanceScoreService.calculateDailyPerformanceScore(
      userId,
      hierarchy.organizationId,
      start,
      end
    );
    performanceScore = scoreResult.performanceScore;
  } catch (_) {
    performanceScore = 80;
  }

  const reportId = existing?.reportId || generateReportId(targetDate, 1);

  const accomplishments = payload.accomplishments || payload.summary || payload.completedSummary || null;
  const challenges = payload.challenges || (blockersList.length > 0 ? blockersList.map((b) => b.title).join("; ") : null);
  const additionalRemarks = payload.additionalRemarks || payload.additionalWork || null;
  const tomorrowPlan = payload.tomorrowPlan || payload.tomorrowPriority || null;

  const reportData: Partial<IDailyReport> = {
    reportId,
    userId: new mongoose.Types.ObjectId(userId),
    organizationId: new mongoose.Types.ObjectId(hierarchy.organizationId),
    departmentId: hierarchy.departmentId ? new mongoose.Types.ObjectId(hierarchy.departmentId) : null,
    teamId: hierarchy.teamId ? new mongoose.Types.ObjectId(hierarchy.teamId) : null,
    managerId: hierarchy.managerId ? new mongoose.Types.ObjectId(hierarchy.managerId) : null,
    teamLeadId: hierarchy.teamLeadId ? new mongoose.Types.ObjectId(hierarchy.teamLeadId) : null,
    reportDate: start,
    completedTaskIds: authoritativeTaskData.completedTaskIds.map((id) => new mongoose.Types.ObjectId(id)),
    inProgressTaskIds: authoritativeTaskData.inProgressTaskIds.map((id) => new mongoose.Types.ObjectId(id)),
    pendingTaskIds: authoritativeTaskData.pendingTaskIds.map((id) => new mongoose.Types.ObjectId(id)),
    totalTasksWorked: authoritativeTaskData.totalTasksWorked,
    completedTasks: authoritativeTaskData.completedTasks,
    pendingTasks: authoritativeTaskData.pendingTasks,
    totalWorkedMinutes: authoritativeTaskData.totalWorkedMinutes,
    taskWorkedMinutes: authoritativeTaskData.taskWorkedMinutes,
    attendanceMinutes: authoritativeTaskData.attendanceMinutes,
    breakMinutes: authoritativeTaskData.breakMinutes,
    attendanceStatus: authoritativeTaskData.attendanceStatus,
    checkInTime: authoritativeTaskData.checkInTime,
    checkOutTime: authoritativeTaskData.checkOutTime,
    blockerCount: blockersList.length,
    blockers: blockersList,
    accomplishments,
    challenges,
    additionalRemarks,
    tomorrowPlan,
    summary: accomplishments,
    completedSummary: accomplishments,
    highlights: payload.highlights || [],
    achievements: payload.achievements || [],
    plannedTasks: payload.plannedTasks || [],
    tasksAssigned: authoritativeTaskData.tasksAssigned,
    tasksCompleted: authoritativeTaskData.tasksCompleted,
    tasksSubmitted: authoritativeTaskData.tasksSubmitted,
    tasksApproved: authoritativeTaskData.tasksApproved,
    tasksRework: authoritativeTaskData.tasksRework,
    tasksPending: authoritativeTaskData.tasksPending,
    tasksOverdue: authoritativeTaskData.tasksOverdue,
    tasksCarriedForward: authoritativeTaskData.tasksCarriedForward,
    performanceScore,
    status: nextStatus,
    submittedAt: isSubmitting ? new Date() : existing?.submittedAt || null,
  };

  let savedDoc: IDailyReport;

  if (existing) {
    Object.assign(existing, reportData);
    savedDoc = await existing.save();
  } else {
    savedDoc = await DailyReport.create(reportData);
  }

  // Points, Performance & Realtime Socket Emitters
  if (isSubmitting) {
    // Award points (idempotent: exactly once per EOD report)
    try {
      await PointService.awardPoints(
        userId,
        hierarchy.organizationId,
        "DAILY_REPORT_SUBMITTED",
        savedDoc._id,
        userId
      );
    } catch (err) {
      console.error("Failed to award EOD points:", err);
    }

    // Regenerate daily performance snapshot
    try {
      await PerformanceScoreService.createDailyPerformanceSnapshot(
        userId,
        hierarchy.organizationId,
        start,
        true
      );
    } catch (err) {
      console.error("Failed to regenerate performance snapshot on EOD submission:", err);
    }

    // Emit real-time socket event
    emitEODSubmitted(
      userId,
      savedDoc,
      hierarchy.organizationId,
      hierarchy.teamId,
      hierarchy.managerId,
      hierarchy.teamLeadId
    );

    await recordAuditLog({
      organizationId: hierarchy.organizationId,
      actorId: userId,
      actorRole: hierarchy.user.role,
      action: "EOD_SUBMITTED",
      entityType: "DAILY_REPORT",
      entityId: String(savedDoc._id),
      summary: `${hierarchy.user.fullName} submitted EOD report for ${start.toISOString().split("T")[0]}`,
    });

    const notifyRecipients = [hierarchy.teamLeadId, hierarchy.managerId].filter(
      (id): id is string => Boolean(id && String(id) !== userId)
    );

    for (const recipientId of notifyRecipients) {
      await createNotification({
        recipientId,
        organizationId: hierarchy.organizationId,
        type: "EOD_REPORT_SUBMITTED",
        title: "EOD Report Submitted",
        message: `${hierarchy.user.fullName} submitted an EOD report for review.`,
        entityType: "DAILY_REPORT",
        entityId: String(savedDoc._id),
        priority: "NORMAL",
      });
    }

    // Check for critical blockers to escalate
    const criticalBlockers = blockersList.filter((b) => b.severity === "HIGH" || b.severity === "CRITICAL");
    if (criticalBlockers.length > 0) {
      for (const recipientId of notifyRecipients) {
        await createNotification({
          recipientId,
          organizationId: hierarchy.organizationId,
          type: "BLOCKER_ESCALATED",
          title: "Critical Blocker Reported in EOD",
          message: `${hierarchy.user.fullName} reported ${criticalBlockers.length} critical blocker(s): "${criticalBlockers[0].title}".`,
          entityType: "DAILY_REPORT",
          entityId: String(savedDoc._id),
          priority: "HIGH",
        });
      }
    }
  } else {
    emitEODUpdated(userId, savedDoc, hierarchy.organizationId);

    await recordAuditLog({
      organizationId: hierarchy.organizationId,
      actorId: userId,
      actorRole: hierarchy.user.role,
      action: existing ? "EOD_UPDATED" : "EOD_CREATED",
      entityType: "DAILY_REPORT",
      entityId: String(savedDoc._id),
      summary: `Saved EOD draft for ${start.toISOString().split("T")[0]}`,
    });
  }

  return savedDoc.toObject();
}

export async function getEODReportById(id: string, requester: any) {
  const report = await DailyReport.findById(id)
    .populate("userId", "_id fullName email employeeId designation role status departmentId teamId")
    .populate("reviewedBy", "_id fullName email employeeId designation role")
    .populate("completedTaskIds", "_id taskId title status priority completionPercentage")
    .populate("inProgressTaskIds", "_id taskId title status priority completionPercentage")
    .populate("pendingTaskIds", "_id taskId title status priority completionPercentage")
    .populate("teamId", "_id name code managerId teamLeadId")
    .populate("departmentId", "_id name code")
    .lean();

  if (!report) throw new Error("REPORT_NOT_FOUND");

  const reportOrgId = String(report.organizationId || "");
  const requesterOrgId = String(requester.organizationId || "");
  const targetUserId = String((report.userId as any)?._id || report.userId || "");

  // Super Admin: cross-organization access
  if (requester.role === "SUPER_ADMIN") {
    return report;
  }

  // Admin: same organization
  if (requester.role === "ADMIN") {
    if (reportOrgId !== requesterOrgId) throw new Error("FORBIDDEN");
    return report;
  }

  // Manager: scoped to managed teams
  if (requester.role === "MANAGER") {
    const scope = await getManagementScope(requester);
    if (!scope.scopedUserIds.includes(targetUserId) && targetUserId !== String(requester._id)) {
      throw new Error("FORBIDDEN");
    }
    return report;
  }

  // Team Leader: scoped to own team
  if (requester.role === "TEAM_LEADER") {
    const scope = await getManagementScope(requester);
    if (!scope.scopedUserIds.includes(targetUserId) && targetUserId !== String(requester._id)) {
      throw new Error("FORBIDDEN");
    }
    return report;
  }

  // Employee: strictly own report
  if (targetUserId !== String(requester._id)) {
    throw new Error("FORBIDDEN");
  }

  return report;
}

export async function listEODReports(requester: any, query: any = {}) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};

  if (query.status) {
    const statusVal = String(query.status).toUpperCase();
    if (statusVal === "REWORK_REQUIRED" || statusVal === "RETURNED") {
      filter.status = { $in: ["RETURNED", "REWORK_REQUIRED"] };
    } else {
      filter.status = statusVal;
    }
  }

  if (query.date || query.reportDate) {
    const d = new Date(query.date || query.reportDate);
    filter.reportDate = { $gte: startOfDay(d), $lte: endOfDay(d) };
  }

  if (query.teamId) filter.teamId = query.teamId;
  if (query.departmentId) filter.departmentId = query.departmentId;
  if (query.managerId) filter.managerId = query.managerId;
  if (query.teamLeadId) filter.teamLeadId = query.teamLeadId;

  // Authorization Scoping
  if (requester.role === "SUPER_ADMIN") {
    if (query.organizationId) filter.organizationId = query.organizationId;
    if (query.userId || query.employeeId) filter.userId = query.userId || query.employeeId;
  } else if (requester.role === "ADMIN") {
    filter.organizationId = requester.organizationId;
    if (query.userId || query.employeeId) filter.userId = query.userId || query.employeeId;
  } else if (requester.role === "MANAGER" || requester.role === "TEAM_LEADER") {
    filter.organizationId = requester.organizationId;
    const scope = await getManagementScope(requester);

    if (query.userId || query.employeeId) {
      const targetUser = String(query.userId || query.employeeId);
      if (!scope.scopedUserIds.includes(targetUser)) {
        throw new Error("FORBIDDEN");
      }
      filter.userId = targetUser;
    } else if (query.teamId && scope.managedTeamIds.includes(String(query.teamId))) {
      filter.teamId = query.teamId;
    } else {
      filter.userId = { $in: scope.scopedUserIds };
    }
  } else {
    // Regular employee / intern
    filter.userId = String(requester._id);
  }

  const [items, total] = await Promise.all([
    DailyReport.find(filter)
      .populate("userId", "_id fullName email employeeId designation role status")
      .populate("reviewedBy", "_id fullName email employeeId designation role")
      .populate("teamId", "_id name code")
      .populate("departmentId", "_id name code")
      .sort({ reportDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    DailyReport.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function approveEODReport(id: string, reviewer: any, reviewRemarks?: string) {
  const report = await DailyReport.findById(id);
  if (!report) throw new Error("REPORT_NOT_FOUND");

  const targetUserId = String(report.userId);
  const reviewerId = String(reviewer._id);

  // Self-approval guard
  if (targetUserId === reviewerId) {
    throw new Error("CANNOT_REVIEW_OWN_REPORT");
  }

  // Validate management authority
  if (reviewer.role === "SUPER_ADMIN") {
    // Allowed
  } else if (reviewer.role === "ADMIN") {
    if (String(report.organizationId) !== String(reviewer.organizationId)) throw new Error("FORBIDDEN");
  } else if (reviewer.role === "MANAGER" || reviewer.role === "TEAM_LEADER") {
    const scope = await getManagementScope(reviewer);
    if (!scope.scopedUserIds.includes(targetUserId)) {
      throw new Error("FORBIDDEN");
    }
  } else {
    throw new Error("FORBIDDEN");
  }

  report.status = "APPROVED";
  report.reviewedAt = new Date();
  report.reviewedBy = new mongoose.Types.ObjectId(reviewerId);
  report.reviewRemarks = reviewRemarks || report.reviewRemarks || null;
  report.reviewerRemarks = reviewRemarks || report.reviewerRemarks || null;
  await report.save();

  // Create authoritative daily performance snapshot upon approval
  try {
    await PerformanceScoreService.createDailyPerformanceSnapshot(
      targetUserId,
      String(report.organizationId),
      report.reportDate
    );
  } catch (err) {
    console.error("Failed to generate performance snapshot on approval:", err);
  }

  // Notifications & Audit Log
  await createNotification({
    recipientId: targetUserId,
    organizationId: String(report.organizationId),
    type: "EOD_APPROVED",
    title: "EOD Report Approved",
    message: `Your EOD report for ${report.reportDate.toISOString().split("T")[0]} was approved by ${reviewer.fullName}.`,
    entityType: "DAILY_REPORT",
    entityId: String(report._id),
    priority: "NORMAL",
  });

  emitEODReviewed(
    targetUserId,
    report,
    String(report.organizationId),
    report.teamId ? String(report.teamId) : null,
    reviewerId
  );

  await recordAuditLog({
    organizationId: String(report.organizationId),
    actorId: reviewerId,
    actorRole: reviewer.role,
    action: "EOD_APPROVED",
    entityType: "DAILY_REPORT",
    entityId: String(report._id),
    summary: `Approved EOD report for employee (${targetUserId})`,
    metadata: { reviewRemarks },
  });

  return report.toObject();
}

export async function returnEODReport(id: string, reviewer: any, reworkReason: string) {
  if (!reworkReason || reworkReason.trim().length === 0) {
    throw new Error("REWORK_REASON_REQUIRED");
  }

  const report = await DailyReport.findById(id);
  if (!report) throw new Error("REPORT_NOT_FOUND");

  const targetUserId = String(report.userId);
  const reviewerId = String(reviewer._id);

  if (targetUserId === reviewerId) {
    throw new Error("CANNOT_REVIEW_OWN_REPORT");
  }

  if (reviewer.role === "SUPER_ADMIN") {
    // Allowed
  } else if (reviewer.role === "ADMIN") {
    if (String(report.organizationId) !== String(reviewer.organizationId)) throw new Error("FORBIDDEN");
  } else if (reviewer.role === "MANAGER" || reviewer.role === "TEAM_LEADER") {
    const scope = await getManagementScope(reviewer);
    if (!scope.scopedUserIds.includes(targetUserId)) {
      throw new Error("FORBIDDEN");
    }
  } else {
    throw new Error("FORBIDDEN");
  }

  report.status = "RETURNED";
  report.reviewedAt = new Date();
  report.reviewedBy = new mongoose.Types.ObjectId(reviewerId);
  report.reviewRemarks = reworkReason;
  report.reviewerRemarks = reworkReason;
  report.reworkReason = reworkReason;
  await report.save();

  // Regenerate performance snapshot on report return / rework
  try {
    await PerformanceScoreService.createDailyPerformanceSnapshot(
      targetUserId,
      String(report.organizationId),
      report.reportDate,
      true
    );
  } catch (err) {
    console.error("Failed to regenerate performance snapshot on return:", err);
  }

  await createNotification({
    recipientId: targetUserId,
    organizationId: String(report.organizationId),
    type: "EOD_RETURNED",
    title: "EOD Report Returned for Correction",
    message: `Your EOD report for ${report.reportDate.toISOString().split("T")[0]} was returned: "${reworkReason}".`,
    entityType: "DAILY_REPORT",
    entityId: String(report._id),
    priority: "HIGH",
  });

  emitEODReviewed(
    targetUserId,
    report,
    String(report.organizationId),
    report.teamId ? String(report.teamId) : null,
    reviewerId
  );

  await recordAuditLog({
    organizationId: String(report.organizationId),
    actorId: reviewerId,
    actorRole: reviewer.role,
    action: "EOD_RETURNED",
    entityType: "DAILY_REPORT",
    entityId: String(report._id),
    summary: `Returned EOD report for employee (${targetUserId}): ${reworkReason}`,
    metadata: { reworkReason },
  });

  return report.toObject();
}
