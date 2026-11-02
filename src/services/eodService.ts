import mongoose from "mongoose";
import DailyReport, { IDailyReport, DailyReportStatus, IEODBlocker } from "../models/DailyReport";
import Task from "../models/Task";
import TaskTimeSession from "../models/TaskTimeSession";
import Attendance from "../models/Attendance";
import User from "../models/User";
import Team from "../models/Team";
import Department from "../models/Department";
import Organization from "../models/Organization";
import { getManagementScope } from "../utils/scopeHelper";
import { recordAuditLog } from "./auditLogService";
import { createNotification } from "./notificationService";
import { PerformanceScoreService } from "./performanceScoreService";

// Ensure mongoose models are loaded
const _models = [Organization, Department, Team, User, Task, Attendance, TaskTimeSession, DailyReport];

// Weights for transparent performance scoring
export const TASK_COMPLETION_WEIGHT = 0.35;
export const TIME_TRACKING_WEIGHT = 0.25;
export const TIMELINESS_WEIGHT = 0.20;
export const QUALITY_WEIGHT = 0.20;

export function startOfDay(d = new Date()): Date {
  const res = new Date(d);
  res.setHours(0, 0, 0, 0);
  return res;
}

export function endOfDay(d = new Date()): Date {
  const res = new Date(d);
  res.setHours(23, 59, 59, 999);
  return res;
}

function generateReportId(date = new Date()): string {
  const dStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `EOD-${dStr}-${rand}`;
}

export async function resolveUserHierarchy(userId: string) {
  const user = await User.findById(userId)
    .populate("organizationId")
    .populate("departmentId")
    .populate("teamId")
    .lean();

  if (!user) throw new Error("USER_NOT_FOUND");

  let teamLeadId: string | null = null;
  let managerId: string | null = null;

  if (user.teamId) {
    const team = await Team.findById((user.teamId as any)._id || user.teamId).lean();
    if (team) {
      if (team.teamLeadId) teamLeadId = String(team.teamLeadId);
      if (team.managerId) managerId = String(team.managerId);
    }
  }

  return {
    userId: String(user._id),
    employeeId: String(user._id),
    organizationId: String((user.organizationId as any)?._id || user.organizationId || ""),
    departmentId: user.departmentId ? String((user.departmentId as any)._id || user.departmentId) : null,
    teamId: user.teamId ? String((user.teamId as any)._id || user.teamId) : null,
    managerId,
    teamLeadId,
    user,
  };
}

export async function calculateLiveTaskSnapshot(employeeId: string, date = new Date()) {
  const s = startOfDay(date);
  const e = endOfDay(date);

  const assignedTasks = await Task.find({
    assignedTo: employeeId,
    $or: [
      { createdAt: { $gte: s, $lte: e } },
      { updatedAt: { $gte: s, $lte: e } },
      { completedAt: { $gte: s, $lte: e } },
      { status: { $in: ["IN_PROGRESS", "TODO", "ASSIGNED", "PAUSED", "REVIEW", "REWORK"] } },
    ],
  }).lean();

  const completedTaskIds: string[] = [];
  const inProgressTaskIds: string[] = [];
  const pendingTaskIds: string[] = [];

  let tasksAssigned = assignedTasks.length;
  let tasksCompleted = 0;
  let tasksSubmitted = 0;
  let tasksInProgress = 0;
  let tasksBlocked = 0;
  let tasksRejectedForRework = 0;
  let tasksPending = 0;
  let tasksOverdue = 0;
  let estimatedTaskMinutes = 0;
  let actualTaskMinutes = 0;

  const now = new Date();

  for (const t of assignedTasks) {
    const tId = String(t._id);
    estimatedTaskMinutes += Number(t.estimatedMinutes || 0);
    actualTaskMinutes += Number(t.actualMinutes || 0);

    if (t.status === "COMPLETED") {
      tasksCompleted++;
      completedTaskIds.push(tId);
    } else if (t.status === "REVIEW") {
      tasksSubmitted++;
      inProgressTaskIds.push(tId);
    } else if (t.status === "IN_PROGRESS") {
      tasksInProgress++;
      inProgressTaskIds.push(tId);
    } else if (t.status === "REWORK") {
      tasksRejectedForRework++;
      tasksBlocked++;
      pendingTaskIds.push(tId);
    } else {
      tasksPending++;
      pendingTaskIds.push(tId);
    }

    if (t.dueDate && new Date(t.dueDate) < now && !["COMPLETED", "CANCELLED"].includes(t.status)) {
      tasksOverdue++;
    }
  }

  // Work session time tracking
  const timeSessions = await TaskTimeSession.find({
    userId: employeeId,
    startedAt: { $gte: s, $lte: e },
  }).lean();

  const totalTrackedSeconds = timeSessions.reduce((acc, sess) => acc + Number((sess as any).activeSeconds || 0), 0);
  const totalTrackedMinutes = Math.round(totalTrackedSeconds / 60);

  // Attendance telemetry
  const attendance = await Attendance.findOne({
    userId: employeeId,
    date: { $gte: s, $lte: e },
  }).lean();

  const attendanceMinutes = attendance ? Math.round(Number(attendance.totalWorkDuration || 0) / 60000) : 0;
  const breakMinutes = attendance ? Math.round(Number(attendance.totalBreakDuration || 0) / 60000) : 0;
  const productiveMinutes = totalTrackedMinutes > 0 ? totalTrackedMinutes : attendanceMinutes;
  const idleMinutes = Math.max(0, attendanceMinutes - productiveMinutes);

  return {
    tasksAssigned,
    tasksCompleted,
    tasksSubmitted,
    tasksInProgress,
    tasksBlocked,
    tasksRejectedForRework,
    tasksPending,
    tasksOverdue,
    estimatedTaskMinutes,
    actualTaskMinutes,
    totalTrackedMinutes: productiveMinutes,
    productiveMinutes,
    idleMinutes,
    attendanceMinutes,
    breakMinutes,
    attendanceStatus: attendance?.attendanceStatus || (attendance?.currentStatus === "ONLINE" ? "PRESENT" : "OFFLINE"),
    checkInTime: attendance?.firstLoginAt || null,
    checkOutTime: attendance?.lastLogoutAt || null,
    completedTaskIds,
    inProgressTaskIds,
    pendingTaskIds,
  };
}

export function calculateEODPerformanceScore(data: {
  tasksAssigned: number;
  tasksCompleted: number;
  tasksSubmitted: number;
  tasksRejectedForRework: number;
  productiveMinutes: number;
  tasksOverdue: number;
  status: string;
}) {
  const completionRatio = data.tasksAssigned > 0 ? Math.min(1, data.tasksCompleted / data.tasksAssigned) : 0.8;
  const completionScore = completionRatio * 100 * TASK_COMPLETION_WEIGHT;

  const timeRatio = Math.min(1, data.productiveMinutes / 480); // Target 8h = 480m
  const timeScore = timeRatio * 100 * TIME_TRACKING_WEIGHT;

  const timelinessRatio = data.tasksAssigned > 0 ? Math.max(0, (data.tasksAssigned - data.tasksOverdue) / data.tasksAssigned) : 1;
  const timelinessScore = timelinessRatio * 100 * TIMELINESS_WEIGHT;

  const qualityRatio = data.tasksAssigned > 0 ? Math.max(0, (data.tasksAssigned - data.tasksRejectedForRework) / data.tasksAssigned) : 1;
  const qualityScore = qualityRatio * 100 * QUALITY_WEIGHT;

  const rawScore = Math.round(completionScore + timeScore + timelinessScore + qualityScore);
  return Math.min(100, Math.max(0, rawScore));
}

export class EODService {
  /**
   * 1. CREATE OR UPDATE TODAY'S EOD DRAFT
   */
  static async createOrUpdateEODDraft(employeeId: string, input: any) {
    const reportDate = input.reportDate ? new Date(input.reportDate) : new Date();
    const s = startOfDay(reportDate);
    const e = endOfDay(reportDate);

    const hierarchy = await resolveUserHierarchy(employeeId);
    const taskData = await calculateLiveTaskSnapshot(employeeId, reportDate);

    const rawBlockers = Array.isArray(input.blockers) ? input.blockers : [];
    const formattedBlockers: IEODBlocker[] = rawBlockers.map((b: any, idx: number) => ({
      blockerId: b.blockerId || `BLK-${Date.now()}-${idx}`,
      title: b.title || b.description || `Blocker ${idx + 1}`,
      description: b.description || b.title || "",
      category: b.category || "GENERAL",
      dependency: b.dependency || "",
      severity: b.severity || "MEDIUM",
      relatedTaskId: b.relatedTaskId || null,
      createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
      resolved: Boolean(b.resolved),
      resolvedAt: b.resolved ? (b.resolvedAt ? new Date(b.resolvedAt) : new Date()) : null,
    }));

    let existingReport = await DailyReport.findOne({
      organizationId: hierarchy.organizationId,
      userId: employeeId,
      reportDate: { $gte: s, $lte: e },
    });

    const isSubmission = input.action === "SUBMIT" || input.status === "SUBMITTED";

    if (existingReport) {
      if (existingReport.status === "APPROVED" || existingReport.status === "LOCKED") {
        throw new Error("EOD_ALREADY_LOCKED");
      }
      if (
        ["SUBMITTED", "TEAM_LEAD_REVIEW", "MANAGER_REVIEW"].includes(existingReport.status) &&
        !isSubmission
      ) {
        throw new Error("EOD_ALREADY_SUBMITTED");
      }
    }

    let nextStatus: DailyReportStatus = "DRAFT";
    if (isSubmission) {
      if (hierarchy.teamLeadId && hierarchy.teamLeadId !== employeeId) {
        nextStatus = "TEAM_LEAD_REVIEW";
      } else if (hierarchy.managerId && hierarchy.managerId !== employeeId) {
        nextStatus = "MANAGER_REVIEW";
      } else {
        nextStatus = "SUBMITTED";
      }
    } else if (existingReport && existingReport.status === "REWORK_REQUIRED") {
      nextStatus = "REWORK_REQUIRED";
    }

    const performanceScore = calculateEODPerformanceScore({
      tasksAssigned: taskData.tasksAssigned,
      tasksCompleted: taskData.tasksCompleted,
      tasksSubmitted: taskData.tasksSubmitted,
      tasksRejectedForRework: taskData.tasksRejectedForRework,
      productiveMinutes: taskData.productiveMinutes,
      tasksOverdue: taskData.tasksOverdue,
      status: nextStatus,
    });

    const updatePayload: Record<string, any> = {
      userId: employeeId,
      employeeId: employeeId,
      organizationId: hierarchy.organizationId,
      departmentId: hierarchy.departmentId,
      teamId: hierarchy.teamId,
      managerId: hierarchy.managerId,
      teamLeadId: hierarchy.teamLeadId,
      reportDate: s,
      employeeSummary: input.employeeSummary || input.summary || existingReport?.employeeSummary || "",
      summary: input.summary || input.employeeSummary || existingReport?.summary || "",
      accomplishments: input.accomplishments || existingReport?.accomplishments || null,
      challenges: input.challenges || existingReport?.challenges || null,
      nextDayPlan: input.nextDayPlan || input.tomorrowPlan || existingReport?.nextDayPlan || null,
      tomorrowPlan: input.tomorrowPlan || input.nextDayPlan || existingReport?.tomorrowPlan || null,
      additionalRemarks: input.additionalRemarks || existingReport?.additionalRemarks || null,
      achievements: Array.isArray(input.achievements) ? input.achievements : existingReport?.achievements || [],
      blockers: formattedBlockers.length > 0 ? formattedBlockers : existingReport?.blockers || [],
      blockerCount: formattedBlockers.length > 0 ? formattedBlockers.length : existingReport?.blockerCount || 0,
      totalTasksWorked: taskData.tasksAssigned,
      tasksAssigned: taskData.tasksAssigned,
      tasksCompleted: taskData.tasksCompleted,
      tasksSubmitted: taskData.tasksSubmitted,
      tasksInProgress: taskData.tasksInProgress,
      tasksBlocked: taskData.tasksBlocked,
      tasksRejectedForRework: taskData.tasksRejectedForRework,
      tasksPending: taskData.tasksPending,
      tasksOverdue: taskData.tasksOverdue,
      estimatedTaskMinutes: taskData.estimatedTaskMinutes,
      actualTaskMinutes: taskData.actualTaskMinutes,
      totalWorkedMinutes: taskData.productiveMinutes,
      totalTrackedMinutes: taskData.productiveMinutes,
      productiveMinutes: taskData.productiveMinutes,
      idleMinutes: taskData.idleMinutes,
      attendanceMinutes: taskData.attendanceMinutes,
      breakMinutes: taskData.breakMinutes,
      attendanceStatus: taskData.attendanceStatus,
      checkInTime: taskData.checkInTime,
      checkOutTime: taskData.checkOutTime,
      completedTaskIds: taskData.completedTaskIds,
      inProgressTaskIds: taskData.inProgressTaskIds,
      pendingTaskIds: taskData.pendingTaskIds,
      performanceScore,
      status: nextStatus,
    };

    if (isSubmission) {
      updatePayload.submittedAt = new Date();
    }

    if (!existingReport) {
      updatePayload.reportId = generateReportId(reportDate);
      existingReport = await DailyReport.create(updatePayload);

      await recordAuditLog({
        organizationId: hierarchy.organizationId,
        actorId: employeeId,
        actorRole: hierarchy.user.role,
        action: isSubmission ? "EOD_SUBMITTED" : "EOD_CREATED",
        entityType: "EOD_REPORT",
        entityId: String(existingReport._id),
        metadata: { reportId: existingReport.reportId, status: nextStatus },
      });
    } else {
      Object.assign(existingReport, updatePayload);
      await existingReport.save();

      await recordAuditLog({
        organizationId: hierarchy.organizationId,
        actorId: employeeId,
        actorRole: hierarchy.user.role,
        action: isSubmission ? "EOD_SUBMITTED" : "EOD_UPDATED",
        entityType: "EOD_REPORT",
        entityId: String(existingReport._id),
        metadata: { reportId: existingReport.reportId, status: nextStatus },
      });
    }

    if (isSubmission) {
      if (nextStatus === "TEAM_LEAD_REVIEW" && hierarchy.teamLeadId) {
        await createNotification({
          recipientId: hierarchy.teamLeadId,
          organizationId: hierarchy.organizationId,
          type: "EOD_REPORT_SUBMITTED" as any,
          title: "Daily Work Report Submitted",
          message: `${hierarchy.user.fullName} submitted their EOD report for review.`,
          entityId: String(existingReport._id),
          entityType: "EOD_REPORT",
        });
      } else if (nextStatus === "MANAGER_REVIEW" && hierarchy.managerId) {
        await createNotification({
          recipientId: hierarchy.managerId,
          organizationId: hierarchy.organizationId,
          type: "EOD_REPORT_SUBMITTED" as any,
          title: "Daily Work Report Submitted",
          message: `${hierarchy.user.fullName} submitted their EOD report for review.`,
          entityId: String(existingReport._id),
          entityType: "EOD_REPORT",
        });
      }
    }

    return existingReport;
  }

  /**
   * 2. SUBMIT EOD REPORT
   */
  static async submitEOD(reportId: string, authUser: any) {
    const report = await DailyReport.findById(reportId);
    if (!report) throw new Error("REPORT_NOT_FOUND");

    const authId = String(authUser._id || authUser.id);
    if (String(report.userId) !== authId && !["SUPER_ADMIN", "ADMIN"].includes(authUser.role)) {
      throw new Error("FORBIDDEN");
    }

    if (report.status === "APPROVED" || report.status === "LOCKED") {
      throw new Error("EOD_ALREADY_LOCKED");
    }

    const hierarchy = await resolveUserHierarchy(String(report.userId));
    let nextStatus: DailyReportStatus = "SUBMITTED";

    if (hierarchy.teamLeadId && hierarchy.teamLeadId !== String(report.userId)) {
      nextStatus = "TEAM_LEAD_REVIEW";
    } else if (hierarchy.managerId && hierarchy.managerId !== String(report.userId)) {
      nextStatus = "MANAGER_REVIEW";
    }

    report.status = nextStatus;
    report.submittedAt = new Date();
    await report.save();

    await recordAuditLog({
      organizationId: String(report.organizationId),
      actorId: authId,
      actorRole: authUser.role,
      action: "EOD_SUBMITTED",
      entityType: "EOD_REPORT",
      entityId: String(report._id),
      metadata: { reportId: report.reportId, nextStatus },
    });

    const reviewerId = nextStatus === "TEAM_LEAD_REVIEW" ? hierarchy.teamLeadId : hierarchy.managerId;
    if (reviewerId) {
      await createNotification({
        recipientId: reviewerId,
        organizationId: String(report.organizationId),
        type: "EOD_REPORT_SUBMITTED" as any,
        title: "Daily Work Report Submitted",
        message: `An EOD report was submitted for review.`,
        entityId: String(report._id),
        entityType: "EOD_REPORT",
      });
    }

    return report;
  }

  /**
   * 3. TEAM LEAD REVIEW
   */
  static async teamLeadReview(reportId: string, authUser: any, input: { remarks?: string; score?: number; action?: string }) {
    const report = await DailyReport.findById(reportId);
    if (!report) throw new Error("REPORT_NOT_FOUND");

    const authId = String(authUser._id || authUser.id);
    if (String(report.userId) === authId) {
      throw new Error("CANNOT_REVIEW_OWN_REPORT");
    }

    if (!["SUPER_ADMIN", "ADMIN"].includes(authUser.role)) {
      if (authUser.role === "TEAM_LEADER") {
        if (report.teamLeadId && String(report.teamLeadId) !== authId) {
          throw new Error("FORBIDDEN");
        }
      } else if (authUser.role === "MANAGER") {
        const scope = await getManagementScope(authUser);
        if (report.teamId && !scope.managedTeamIds.includes(String(report.teamId))) {
          throw new Error("FORBIDDEN");
        }
      } else {
        throw new Error("FORBIDDEN");
      }
    }

    const action = (input.action || "APPROVE").toUpperCase();

    if (action === "REWORK" || action === "REWORK_REQUIRED" || action === "RETURN") {
      report.status = "REWORK_REQUIRED";
      report.reworkReason = input.remarks || "Corrections requested by Team Lead.";
      await report.save();

      await createNotification({
        recipientId: String(report.userId),
        organizationId: String(report.organizationId),
        type: "EOD_RETURNED" as any,
        title: "EOD Report Rework Required",
        message: `Your Team Lead requested rework on your EOD report: ${report.reworkReason}`,
        entityId: String(report._id),
        entityType: "EOD_REPORT",
      });

      await recordAuditLog({
        organizationId: String(report.organizationId),
        actorId: authId,
        actorRole: authUser.role,
        action: "EOD_REWORK_REQUESTED",
        entityType: "EOD_REPORT",
        entityId: String(report._id),
        metadata: { reportId: report.reportId, reason: report.reworkReason },
      });

      return report;
    }

    // Approve / Forward
    report.teamLeadReviewedBy = authId;
    report.teamLeadReviewedAt = new Date();
    report.teamLeadRemarks = input.remarks || null;
    if (typeof input.score === "number") report.teamLeadScore = input.score;

    if (report.managerId && String(report.managerId) !== authId) {
      report.status = "MANAGER_REVIEW";
      await report.save();

      await createNotification({
        recipientId: String(report.managerId),
        organizationId: String(report.organizationId),
        type: "EOD_REPORT_SUBMITTED" as any,
        title: "EOD Report Ready for Manager Review",
        message: `Team Lead signed off on EOD report. Ready for final review.`,
        entityId: String(report._id),
        entityType: "EOD_REPORT",
      });
    } else {
      report.status = "APPROVED";
      report.finalScore = report.teamLeadScore ?? report.performanceScore;
      report.finalRemarks = input.remarks || null;
      report.finalizedAt = new Date();
      report.reviewedAt = new Date();
      report.reviewedBy = authId;
      await report.save();

      await createNotification({
        recipientId: String(report.userId),
        organizationId: String(report.organizationId),
        type: "EOD_APPROVED" as any,
        title: "EOD Report Approved",
        message: `Your daily work report was approved.`,
        entityId: String(report._id),
        entityType: "EOD_REPORT",
      });
    }

    await recordAuditLog({
      organizationId: String(report.organizationId),
      actorId: authId,
      actorRole: authUser.role,
      action: "EOD_TEAM_LEAD_REVIEWED",
      entityType: "EOD_REPORT",
      entityId: String(report._id),
      metadata: { reportId: report.reportId, nextStatus: report.status },
    });

    return report;
  }

  /**
   * 4. MANAGER REVIEW
   */
  static async managerReview(reportId: string, authUser: any, input: { remarks?: string; score?: number; action?: string }) {
    const report = await DailyReport.findById(reportId);
    if (!report) throw new Error("REPORT_NOT_FOUND");

    const authId = String(authUser._id || authUser.id);
    if (String(report.userId) === authId) {
      throw new Error("CANNOT_REVIEW_OWN_REPORT");
    }

    if (!["SUPER_ADMIN", "ADMIN"].includes(authUser.role)) {
      if (authUser.role === "MANAGER") {
        const scope = await getManagementScope(authUser);
        if (report.teamId && !scope.managedTeamIds.includes(String(report.teamId))) {
          throw new Error("FORBIDDEN");
        }
      } else {
        throw new Error("FORBIDDEN");
      }
    }

    const action = (input.action || "APPROVE").toUpperCase();

    if (action === "REWORK" || action === "REWORK_REQUIRED" || action === "RETURN") {
      report.status = "REWORK_REQUIRED";
      report.reworkReason = input.remarks || "Corrections requested by Manager.";
      await report.save();

      await createNotification({
        recipientId: String(report.userId),
        organizationId: String(report.organizationId),
        type: "EOD_RETURNED" as any,
        title: "EOD Report Rework Required",
        message: `Your Manager requested rework on your EOD report: ${report.reworkReason}`,
        entityId: String(report._id),
        entityType: "EOD_REPORT",
      });

      await recordAuditLog({
        organizationId: String(report.organizationId),
        actorId: authId,
        actorRole: authUser.role,
        action: "EOD_REWORK_REQUESTED",
        entityType: "EOD_REPORT",
        entityId: String(report._id),
        metadata: { reportId: report.reportId, reason: report.reworkReason },
      });

      return report;
    }

    report.managerReviewedBy = authId;
    report.managerReviewedAt = new Date();
    report.managerRemarks = input.remarks || null;
    if (typeof input.score === "number") report.managerScore = input.score;

    report.status = "APPROVED";
    report.finalScore = report.managerScore ?? report.teamLeadScore ?? report.performanceScore;
    report.finalRemarks = input.remarks || null;
    report.finalizedAt = new Date();
    report.reviewedAt = new Date();
    report.reviewedBy = authId;
    await report.save();

    // Generate daily performance snapshot upon final manager review
    try {
      await PerformanceScoreService.createDailyPerformanceSnapshot(
        String(report.userId),
        String(report.organizationId),
        report.reportDate,
        true
      );
    } catch (_) {}

    await createNotification({
      recipientId: String(report.userId),
      organizationId: String(report.organizationId),
      type: "EOD_APPROVED" as any,
      title: "EOD Report Approved",
      message: `Your daily work report has been finalized and approved.`,
      entityId: String(report._id),
      entityType: "EOD_REPORT",
    });

    await recordAuditLog({
      organizationId: String(report.organizationId),
      actorId: authId,
      actorRole: authUser.role,
      action: "EOD_MANAGER_REVIEWED",
      entityType: "EOD_REPORT",
      entityId: String(report._id),
      metadata: { reportId: report.reportId, finalScore: report.finalScore },
    });

    return report;
  }

  /**
   * 5. REQUEST REWORK
   */
  static async requestRework(reportId: string, authUser: any, reason: string) {
    return this.teamLeadReview(reportId, authUser, { remarks: reason, action: "REWORK" });
  }

  /**
   * 6. APPROVE / OVERRIDE EOD REPORT
   */
  static async approveEOD(reportId: string, authUser: any, remarks?: string, score?: number) {
    if (["SUPER_ADMIN", "ADMIN"].includes(authUser.role)) {
      const report = await DailyReport.findById(reportId);
      if (!report) throw new Error("REPORT_NOT_FOUND");

      report.status = "APPROVED";
      report.finalScore = score ?? report.managerScore ?? report.teamLeadScore ?? report.performanceScore;
      report.finalRemarks = remarks || "Approved by Admin override.";
      report.finalizedAt = new Date();
      report.reviewedAt = new Date();
      report.reviewedBy = String(authUser._id || authUser.id);
      await report.save();

      try {
        await PerformanceScoreService.createDailyPerformanceSnapshot(
          String(report.userId),
          String(report.organizationId),
          report.reportDate,
          true
        );
      } catch (_) {}

      await createNotification({
        recipientId: String(report.userId),
        organizationId: String(report.organizationId),
        type: "EOD_APPROVED" as any,
        title: "EOD Report Approved",
        message: `Your daily work report was approved by Administrator.`,
        entityId: String(report._id),
        entityType: "EOD_REPORT",
      });

      await recordAuditLog({
        organizationId: String(report.organizationId),
        actorId: String(authUser._id || authUser.id),
        actorRole: authUser.role,
        action: "EOD_ADMIN_OVERRIDE",
        entityType: "EOD_REPORT",
        entityId: String(report._id),
        metadata: { reportId: report.reportId, action: "OVERRIDE_APPROVE" },
      });

      return report;
    }

    if (authUser.role === "MANAGER") {
      return this.managerReview(reportId, authUser, { remarks, score, action: "APPROVE" });
    }

    return this.teamLeadReview(reportId, authUser, { remarks, score, action: "APPROVE" });
  }

  /**
   * 7. GET EOD REPORT BY ID
   */
  static async getEODById(reportId: string, authUser: any) {
    const report = await DailyReport.findById(reportId)
      .populate("userId", "_id fullName email employeeId designation role")
      .populate("teamLeadReviewedBy", "_id fullName email")
      .populate("managerReviewedBy", "_id fullName email")
      .populate("reviewedBy", "_id fullName email")
      .lean();

    if (!report) throw new Error("REPORT_NOT_FOUND");

    const authId = String(authUser._id || authUser.id);

    if (authUser.role === "SUPER_ADMIN") return report;
    if (String(report.organizationId) !== String(authUser.organizationId)) throw new Error("FORBIDDEN");
    if (authUser.role === "ADMIN") return report;
    if (String((report.userId as any)?._id || report.userId) === authId) return report;

    if (authUser.role === "MANAGER") {
      const scope = await getManagementScope(authUser);
      if (report.teamId && scope.managedTeamIds.includes(String(report.teamId))) return report;
    }

    if (authUser.role === "TEAM_LEADER") {
      if (report.teamLeadId && String(report.teamLeadId) === authId) return report;
    }

    throw new Error("FORBIDDEN");
  }

  /**
   * 8. GET UNDERLYING TASKS FOR AN EOD REPORT
   */
  static async getEODTasks(reportId: string, authUser: any) {
    const report = await this.getEODById(reportId, authUser);
    const s = startOfDay(report.reportDate);
    const e = endOfDay(report.reportDate);

    const empId = String((report.userId as any)?._id || report.userId);

    const tasks = await Task.find({
      assignedTo: empId,
      $or: [
        { createdAt: { $gte: s, $lte: e } },
        { updatedAt: { $gte: s, $lte: e } },
        { completedAt: { $gte: s, $lte: e } },
        { status: { $in: ["IN_PROGRESS", "TODO", "ASSIGNED", "PAUSED", "REVIEW", "REWORK"] } },
      ],
    })
      .populate("assignedTo", "_id fullName employeeId designation")
      .lean();

    return tasks;
  }

  /**
   * 9. LIST SCOPED EOD REPORTS
   */
  static async listEODReports(authUser: any, filters: Record<string, any> = {}) {
    const authId = String(authUser._id || authUser.id);
    const query: Record<string, any> = {};

    if (authUser.role === "SUPER_ADMIN") {
      if (filters.organizationId) query.organizationId = filters.organizationId;
    } else {
      query.organizationId = authUser.organizationId;

      if (authUser.role === "ADMIN") {
        if (filters.departmentId) query.departmentId = filters.departmentId;
        if (filters.teamId) query.teamId = filters.teamId;
        if (filters.employeeId || filters.userId) query.userId = filters.employeeId || filters.userId;
      } else if (authUser.role === "MANAGER") {
        const scope = await getManagementScope(authUser);
        if (filters.teamId) {
          if (!scope.managedTeamIds.includes(filters.teamId)) throw new Error("FORBIDDEN");
          query.teamId = filters.teamId;
        } else {
          query.teamId = { $in: scope.managedTeamIds };
        }
        if (filters.employeeId || filters.userId) query.userId = filters.employeeId || filters.userId;
      } else if (authUser.role === "TEAM_LEADER") {
        query.teamLeadId = authId;
        if (filters.employeeId || filters.userId) query.userId = filters.employeeId || filters.userId;
      } else {
        query.userId = authId;
      }
    }

    if (filters.status) query.status = filters.status;
    if (filters.startDate || filters.endDate) {
      query.reportDate = {};
      if (filters.startDate) query.reportDate.$gte = startOfDay(new Date(filters.startDate));
      if (filters.endDate) query.reportDate.$lte = endOfDay(new Date(filters.endDate));
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(filters.limit) || 20));
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      DailyReport.find(query)
        .populate("userId", "_id fullName email employeeId designation role")
        .populate("teamId", "_id name code")
        .populate("teamLeadReviewedBy", "_id fullName email")
        .populate("managerReviewedBy", "_id fullName email")
        .populate("reviewedBy", "_id fullName email")
        .sort({ reportDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DailyReport.countDocuments(query),
    ]);

    return {
      reports,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 10. EOD DASHBOARD METRICS
   */
  static async getEODDashboard(authUser: any, date = new Date()) {
    const s = startOfDay(date);
    const e = endOfDay(date);

    const listResult = await this.listEODReports(authUser, {
      startDate: s.toISOString(),
      endDate: e.toISOString(),
      limit: 100,
    });

    const reports = listResult.reports;

    let submittedCount = 0;
    let teamLeadReviewCount = 0;
    let managerReviewCount = 0;
    let approvedCount = 0;
    let reworkCount = 0;
    let draftCount = 0;

    for (const r of reports) {
      if (r.status === "DRAFT") draftCount++;
      else if (r.status === "TEAM_LEAD_REVIEW") teamLeadReviewCount++;
      else if (r.status === "MANAGER_REVIEW") managerReviewCount++;
      else if (r.status === "APPROVED" || r.status === "REVIEWED") approvedCount++;
      else if (r.status === "REWORK_REQUIRED" || r.status === "RETURNED") reworkCount++;
      else submittedCount++;
    }

    return {
      date: s.toISOString().split("T")[0],
      totalReports: reports.length,
      metrics: {
        draftCount,
        submittedCount,
        teamLeadReviewCount,
        managerReviewCount,
        approvedCount,
        reworkCount,
      },
      reports,
    };
  }
}

export default EODService;
