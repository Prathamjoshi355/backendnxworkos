import mongoose from "mongoose";
import DailyReport, { IDailyReport, DailyReportStatus, IEODBlocker, IReviewHistoryItem } from "../models/DailyReport";
import Task from "../models/Task";
import TaskTimeSession from "../models/TaskTimeSession";
import Attendance from "../models/Attendance";
import Leave from "../models/Leave";
import User from "../models/User";
import Team from "../models/Team";
import Department from "../models/Department";
import Organization from "../models/Organization";
import { getManagementScope } from "../utils/scopeHelper";
import { recordAuditLog } from "./auditLogService";
import { createNotification } from "./notificationService";
import { PerformanceService } from "./performanceService";
import { PerformanceScoreService } from "./performanceScoreService";

// Ensure models are registered
const _models = [Organization, Department, Team, User, Task, Attendance, Leave, TaskTimeSession, DailyReport];

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
  return `DWR-${dStr}-${rand}`;
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

export class DailyWorkReportService {
  /**
   * 1. AUTOMATIC DAY TASK & ATTENDANCE SNAPSHOT CALCULATION
   */
  static async calculateDaySnapshot(employeeId: string, date = new Date()) {
    const s = startOfDay(date);
    const e = endOfDay(date);

    const [assignedTasks, timeSessions, attendance, approvedLeave] = await Promise.all([
      Task.find({
        assignedTo: employeeId,
        $or: [
          { createdAt: { $gte: s, $lte: e } },
          { updatedAt: { $gte: s, $lte: e } },
          { completedAt: { $gte: s, $lte: e } },
          { status: { $in: ["IN_PROGRESS", "TODO", "ASSIGNED", "PAUSED", "REVIEW", "REWORK"] } },
        ],
      }).lean(),
      TaskTimeSession.find({
        userId: employeeId,
        startedAt: { $gte: s, $lte: e },
      }).lean(),
      Attendance.findOne({
        userId: employeeId,
        date: { $gte: s, $lte: e },
      }).lean(),
      Leave.findOne({
        userId: employeeId,
        status: "APPROVED",
        startDate: { $lte: e },
        endDate: { $gte: s },
      }).lean(),
    ]);

    const completedTaskIds: string[] = [];
    const inProgressTaskIds: string[] = [];
    const pendingTaskIds: string[] = [];

    let totalTasksAssigned = assignedTasks.length;
    let totalTasksCompleted = 0;
    let totalTasksInProgress = 0;
    let totalTasksPending = 0;
    let totalTasksRejected = 0;
    let totalTasksReworked = 0;
    let tasksOverdue = 0;
    let totalEstimatedMinutes = 0;
    let totalActualMinutes = 0;

    const now = new Date();

    for (const t of assignedTasks) {
      const tId = String(t._id);
      totalEstimatedMinutes += Number(t.estimatedMinutes || 0);
      totalActualMinutes += Number(t.actualMinutes || 0);

      if (t.status === "COMPLETED") {
        totalTasksCompleted++;
        completedTaskIds.push(tId);
      } else if (t.status === "REVIEW") {
        totalTasksInProgress++;
        inProgressTaskIds.push(tId);
      } else if (t.status === "IN_PROGRESS") {
        totalTasksInProgress++;
        inProgressTaskIds.push(tId);
      } else if (t.status === "REWORK") {
        totalTasksReworked++;
        totalTasksRejected++;
        pendingTaskIds.push(tId);
      } else {
        totalTasksPending++;
        pendingTaskIds.push(tId);
      }

      if (t.dueDate && new Date(t.dueDate) < now && !["COMPLETED", "CANCELLED"].includes(t.status)) {
        tasksOverdue++;
      }
    }

    const trackedSeconds = timeSessions.reduce((acc, sess) => acc + Number((sess as any).activeSeconds || 0), 0);
    const totalTrackedMinutes = Math.round(trackedSeconds / 60);

    const attendanceMinutes = attendance ? Math.round(Number(attendance.totalWorkDuration || 0) / 60000) : 0;
    const breakMinutes = attendance ? Math.round(Number(attendance.totalBreakDuration || 0) / 60000) : 0;
    const productiveMinutes = totalTrackedMinutes > 0 ? totalTrackedMinutes : attendanceMinutes;
    const idleMinutes = Math.max(0, attendanceMinutes - productiveMinutes);

    const completionPercentage =
      totalTasksAssigned > 0 ? Math.min(100, Math.round((totalTasksCompleted / totalTasksAssigned) * 100)) : 100;

    const isLeaveDay = Boolean(approvedLeave);
    const isPartialDay = Boolean(approvedLeave && approvedLeave.totalDays < 1);

    return {
      totalTasksAssigned,
      totalTasksCompleted,
      totalTasksInProgress,
      totalTasksPending,
      totalTasksRejected,
      totalTasksReworked,
      tasksOverdue,
      totalEstimatedMinutes,
      totalActualMinutes,
      totalTrackedMinutes: productiveMinutes,
      productiveMinutes,
      idleMinutes,
      attendanceMinutes,
      breakMinutes,
      completionPercentage,
      attendanceStatus: attendance?.attendanceStatus || (attendance?.currentStatus === "ONLINE" ? "PRESENT" : "OFFLINE"),
      checkInTime: attendance?.firstLoginAt || null,
      checkOutTime: attendance?.lastLogoutAt || null,
      completedTaskIds,
      inProgressTaskIds,
      pendingTaskIds,
      isLeaveDay,
      isPartialDay,
    };
  }

  /**
   * 2. CREATE OR UPDATE DRAFT / RESUBMIT
   */
  static async createOrUpdateReport(employeeId: string, input: any) {
    const reportDate = input.reportDate ? new Date(input.reportDate) : new Date();
    const s = startOfDay(reportDate);
    const e = endOfDay(reportDate);

    const hierarchy = await resolveUserHierarchy(employeeId);
    const dayData = await this.calculateDaySnapshot(employeeId, reportDate);

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
        throw new Error("REPORT_ALREADY_LOCKED");
      }
      if (
        ["SUBMITTED", "TEAM_LEAD_REVIEW", "MANAGER_REVIEW"].includes(existingReport.status) &&
        !isSubmission
      ) {
        throw new Error("REPORT_ALREADY_SUBMITTED");
      }
    }

    let nextStatus: DailyReportStatus = "DRAFT";
    if (isSubmission) {
      if (existingReport && existingReport.status === "REWORK_REQUIRED") {
        nextStatus = "RESUBMITTED";
      } else if (hierarchy.teamLeadId && hierarchy.teamLeadId !== employeeId) {
        nextStatus = "TEAM_LEAD_REVIEW";
      } else if (hierarchy.managerId && hierarchy.managerId !== employeeId) {
        nextStatus = "MANAGER_REVIEW";
      } else {
        nextStatus = "SUBMITTED";
      }
    } else if (existingReport && existingReport.status === "REWORK_REQUIRED") {
      nextStatus = "REWORK_REQUIRED";
    }

    const perfResult = PerformanceService.calculateScore({
      totalTasksAssigned: dayData.totalTasksAssigned,
      totalTasksCompleted: dayData.totalTasksCompleted,
      totalTasksPending: dayData.totalTasksPending,
      totalTasksRejected: dayData.totalTasksRejected,
      totalTasksReworked: dayData.totalTasksReworked,
      tasksOverdue: dayData.tasksOverdue,
      totalEstimatedMinutes: dayData.totalEstimatedMinutes,
      totalActualMinutes: dayData.totalActualMinutes,
      productiveMinutes: dayData.productiveMinutes,
      reviewerScore: existingReport?.teamLeadScore ?? existingReport?.managerScore ?? null,
      isLeaveDay: dayData.isLeaveDay,
      isPartialDay: dayData.isPartialDay,
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
      workSummary: input.workSummary || input.summary || input.employeeSummary || existingReport?.workSummary || "",
      employeeSummary: input.employeeSummary || input.workSummary || input.summary || existingReport?.employeeSummary || "",
      summary: input.summary || input.workSummary || input.employeeSummary || existingReport?.summary || "",
      achievements: Array.isArray(input.achievements) ? input.achievements : existingReport?.achievements || [],
      accomplishments: input.accomplishments || existingReport?.accomplishments || null,
      challenges: input.challenges || existingReport?.challenges || null,
      nextDayPlan: input.nextDayPlan || input.tomorrowPlan || existingReport?.nextDayPlan || null,
      tomorrowPlan: input.tomorrowPlan || input.nextDayPlan || existingReport?.tomorrowPlan || null,
      additionalRemarks: input.additionalRemarks || existingReport?.additionalRemarks || null,
      blockers: formattedBlockers.length > 0 ? formattedBlockers : existingReport?.blockers || [],
      blockerCount: formattedBlockers.length > 0 ? formattedBlockers.length : existingReport?.blockerCount || 0,
      totalTasksAssigned: dayData.totalTasksAssigned,
      totalTasksCompleted: dayData.totalTasksCompleted,
      totalTasksInProgress: dayData.totalTasksInProgress,
      totalTasksPending: dayData.totalTasksPending,
      totalTasksRejected: dayData.totalTasksRejected,
      totalTasksReworked: dayData.totalTasksReworked,
      totalTasksWorked: dayData.totalTasksAssigned,
      totalEstimatedMinutes: dayData.totalEstimatedMinutes,
      totalActualMinutes: dayData.totalActualMinutes,
      completionPercentage: dayData.completionPercentage,
      completedTasks: dayData.totalTasksCompleted,
      pendingTasks: dayData.totalTasksPending,
      tasksAssigned: dayData.totalTasksAssigned,
      tasksCompleted: dayData.totalTasksCompleted,
      tasksSubmitted: dayData.totalTasksInProgress,
      tasksInProgress: dayData.totalTasksInProgress,
      tasksBlocked: dayData.totalTasksReworked,
      tasksRejectedForRework: dayData.totalTasksRejected,
      tasksPending: dayData.totalTasksPending,
      tasksOverdue: dayData.tasksOverdue,
      estimatedTaskMinutes: dayData.totalEstimatedMinutes,
      actualTaskMinutes: dayData.totalActualMinutes,
      totalWorkedMinutes: dayData.productiveMinutes,
      totalTrackedMinutes: dayData.productiveMinutes,
      productiveMinutes: dayData.productiveMinutes,
      idleMinutes: dayData.idleMinutes,
      attendanceMinutes: dayData.attendanceMinutes,
      breakMinutes: dayData.breakMinutes,
      attendanceStatus: dayData.attendanceStatus,
      checkInTime: dayData.checkInTime,
      checkOutTime: dayData.checkOutTime,
      completedTaskIds: dayData.completedTaskIds,
      inProgressTaskIds: dayData.inProgressTaskIds,
      pendingTaskIds: dayData.pendingTaskIds,
      performanceScore: perfResult.performanceScore,
      status: nextStatus,
    };

    if (isSubmission) {
      updatePayload.employeeSubmittedAt = new Date();
      updatePayload.submittedAt = new Date();
    }

    if (!existingReport) {
      updatePayload.reportId = generateReportId(reportDate);
      existingReport = await DailyReport.create(updatePayload);

      await recordAuditLog({
        organizationId: hierarchy.organizationId,
        actorId: employeeId,
        actorRole: hierarchy.user.role,
        action: isSubmission ? "EOD_REPORT_SUBMITTED" : "EOD_REPORT_CREATED",
        entityType: "DAILY_WORK_REPORT",
        entityId: String(existingReport._id),
        metadata: { reportId: existingReport.reportId, status: nextStatus },
      });
    } else {
      if (isSubmission && existingReport.status === "REWORK_REQUIRED") {
        existingReport.reviewHistory.push({
          reviewerId: employeeId,
          reviewerRole: hierarchy.user.role,
          action: "RESUBMITTED",
          comment: "Report resubmitted after corrections.",
          createdAt: new Date(),
        });
      }

      Object.assign(existingReport, updatePayload);
      await existingReport.save();

      await recordAuditLog({
        organizationId: hierarchy.organizationId,
        actorId: employeeId,
        actorRole: hierarchy.user.role,
        action: isSubmission ? (nextStatus === "RESUBMITTED" ? "EOD_REPORT_RESUBMITTED" : "EOD_REPORT_SUBMITTED") : "EOD_REPORT_UPDATED",
        entityType: "DAILY_WORK_REPORT",
        entityId: String(existingReport._id),
        metadata: { reportId: existingReport.reportId, status: nextStatus },
      });
    }

    if (isSubmission) {
      const reviewerId = nextStatus === "TEAM_LEAD_REVIEW" ? hierarchy.teamLeadId : hierarchy.managerId;
      if (reviewerId) {
        await createNotification({
          recipientId: reviewerId,
          organizationId: hierarchy.organizationId,
          type: "EOD_REPORT_SUBMITTED" as any,
          title: "Daily Work Report Submitted",
          message: `${hierarchy.user.fullName} submitted their daily work report.`,
          entityId: String(existingReport._id),
          entityType: "DAILY_WORK_REPORT",
        });
      }
    }

    return existingReport;
  }

  /**
   * 3. SUBMIT REPORT
   */
  static async submitReport(reportId: string, authUser: any) {
    const report = await DailyReport.findById(reportId);
    if (!report) throw new Error("REPORT_NOT_FOUND");

    const authId = String(authUser._id || authUser.id);
    if (String(report.userId) !== authId && !["SUPER_ADMIN", "ADMIN"].includes(authUser.role)) {
      throw new Error("FORBIDDEN");
    }

    if (report.status === "APPROVED" || report.status === "LOCKED") {
      throw new Error("REPORT_ALREADY_LOCKED");
    }

    const hierarchy = await resolveUserHierarchy(String(report.userId));
    let nextStatus: DailyReportStatus = "SUBMITTED";

    if (report.status === "REWORK_REQUIRED") {
      nextStatus = "RESUBMITTED";
      report.reviewHistory.push({
        reviewerId: authId,
        reviewerRole: authUser.role,
        action: "RESUBMITTED",
        comment: "Report resubmitted after rework.",
        createdAt: new Date(),
      });
    } else if (hierarchy.teamLeadId && hierarchy.teamLeadId !== String(report.userId)) {
      nextStatus = "TEAM_LEAD_REVIEW";
    } else if (hierarchy.managerId && hierarchy.managerId !== String(report.userId)) {
      nextStatus = "MANAGER_REVIEW";
    }

    report.status = nextStatus;
    report.employeeSubmittedAt = new Date();
    report.submittedAt = new Date();
    await report.save();

    await recordAuditLog({
      organizationId: String(report.organizationId),
      actorId: authId,
      actorRole: authUser.role,
      action: nextStatus === "RESUBMITTED" ? "EOD_REPORT_RESUBMITTED" : "EOD_REPORT_SUBMITTED",
      entityType: "DAILY_WORK_REPORT",
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
        message: `Daily work report ready for review.`,
        entityId: String(report._id),
        entityType: "DAILY_WORK_REPORT",
      });
    }

    return report;
  }

  /**
   * 4. REVIEW REPORT (TEAM LEAD / MANAGER / ADMIN)
   */
  static async reviewReport(reportId: string, authUser: any, input: { comment?: string; score?: number; action?: string }) {
    const report = await DailyReport.findById(reportId);
    if (!report) throw new Error("REPORT_NOT_FOUND");

    const authId = String(authUser._id || authUser.id);
    if (String(report.userId) === authId) {
      throw new Error("CANNOT_REVIEW_OWN_REPORT");
    }

    // Role scope verification
    if (!["SUPER_ADMIN", "ADMIN"].includes(authUser.role)) {
      if (authUser.role === "TEAM_LEADER") {
        if (report.teamLeadId && String(report.teamLeadId) !== authId) throw new Error("FORBIDDEN");
      } else if (authUser.role === "MANAGER") {
        const scope = await getManagementScope(authUser);
        if (report.teamId && !scope.managedTeamIds.includes(String(report.teamId))) throw new Error("FORBIDDEN");
      } else {
        throw new Error("FORBIDDEN");
      }
    }

    const action = (input.action || "APPROVE").toUpperCase();

    if (action === "REWORK" || action === "REWORK_REQUIRED") {
      report.status = "REWORK_REQUIRED";
      report.reworkReason = input.comment || "Corrections requested.";
      report.reviewerComment = input.comment || null;
      report.reviewerRole = authUser.role;

      report.reviewHistory.push({
        reviewerId: authId,
        reviewerRole: authUser.role,
        action: "REWORK_REQUIRED",
        comment: input.comment || "Rework requested.",
        createdAt: new Date(),
      });

      await report.save();

      await createNotification({
        recipientId: String(report.userId),
        organizationId: String(report.organizationId),
        type: "EOD_REPORT_REWORK_REQUIRED" as any,
        title: "Daily Work Report: Rework Required",
        message: `Your reviewer requested rework: ${report.reworkReason}`,
        entityId: String(report._id),
        entityType: "DAILY_WORK_REPORT",
      });

      await recordAuditLog({
        organizationId: String(report.organizationId),
        actorId: authId,
        actorRole: authUser.role,
        action: "EOD_REPORT_REWORK_REQUIRED",
        entityType: "DAILY_WORK_REPORT",
        entityId: String(report._id),
        metadata: { reportId: report.reportId, reason: report.reworkReason },
      });

      return report;
    }

    // Approve / Forward
    report.reviewedBy = authId;
    report.reviewedAt = new Date();
    report.reviewerRole = authUser.role;
    report.reviewerComment = input.comment || null;

    if (authUser.role === "TEAM_LEADER") {
      report.teamLeadReviewedBy = authId;
      report.teamLeadReviewedAt = new Date();
      report.teamLeadRemarks = input.comment || null;
      if (typeof input.score === "number") report.teamLeadScore = input.score;

      // If manager exists above Team Lead, advance to MANAGER_REVIEW
      if (report.managerId && String(report.managerId) !== authId) {
        report.status = "MANAGER_REVIEW";
        report.reviewHistory.push({
          reviewerId: authId,
          reviewerRole: "TEAM_LEADER",
          action: "TEAM_LEAD_REVIEWED",
          comment: input.comment || "Team Lead sign-off.",
          score: input.score,
          createdAt: new Date(),
        });

        await report.save();

        await createNotification({
          recipientId: String(report.managerId),
          organizationId: String(report.organizationId),
          type: "EOD_REPORT_SUBMITTED" as any,
          title: "Daily Work Report: Manager Review",
          message: `Team Lead signed off on report. Ready for manager review.`,
          entityId: String(report._id),
          entityType: "DAILY_WORK_REPORT",
        });

        await recordAuditLog({
          organizationId: String(report.organizationId),
          actorId: authId,
          actorRole: authUser.role,
          action: "EOD_REPORT_REVIEWED",
          entityType: "DAILY_WORK_REPORT",
          entityId: String(report._id),
          metadata: { reportId: report.reportId, nextStatus: "MANAGER_REVIEW" },
        });

        return report;
      }
    }

    if (authUser.role === "MANAGER") {
      report.managerReviewedBy = authId;
      report.managerReviewedAt = new Date();
      report.managerRemarks = input.comment || null;
      if (typeof input.score === "number") report.managerScore = input.score;
    }

    report.status = "APPROVED";
    report.finalScore = input.score ?? report.managerScore ?? report.teamLeadScore ?? report.performanceScore;
    report.finalRemarks = input.comment || null;
    report.finalizedAt = new Date();

    report.reviewHistory.push({
      reviewerId: authId,
      reviewerRole: authUser.role,
      action: "APPROVED",
      comment: input.comment || "Approved.",
      score: report.finalScore,
      createdAt: new Date(),
    });

    await report.save();

    // Generate daily performance snapshot upon approval
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
      type: "EOD_REPORT_APPROVED" as any,
      title: "Daily Work Report Approved",
      message: `Your daily work report was approved.`,
      entityId: String(report._id),
      entityType: "DAILY_WORK_REPORT",
    });

    await recordAuditLog({
      organizationId: String(report.organizationId),
      actorId: authId,
      actorRole: authUser.role,
      action: "EOD_REPORT_APPROVED",
      entityType: "DAILY_WORK_REPORT",
      entityId: String(report._id),
      metadata: { reportId: report.reportId, finalScore: report.finalScore },
    });

    return report;
  }

  /**
   * 5. REQUEST REWORK
   */
  static async requestRework(reportId: string, authUser: any, comment: string) {
    return this.reviewReport(reportId, authUser, { comment, action: "REWORK" });
  }

  /**
   * 6. GET REPORT BY ID
   */
  static async getReportById(reportId: string, authUser: any) {
    const report = await DailyReport.findById(reportId)
      .populate("userId", "_id fullName email employeeId designation role")
      .populate("teamId", "_id name code")
      .populate("teamLeadReviewedBy", "_id fullName email")
      .populate("managerReviewedBy", "_id fullName email")
      .populate("reviewedBy", "_id fullName email")
      .populate("reviewHistory.reviewerId", "_id fullName email role")
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
   * 7. GET REPORT TIMELINE
   */
  static async getReportTimeline(reportId: string, authUser: any) {
    const report = await this.getReportById(reportId, authUser);
    const s = startOfDay(report.reportDate);
    const e = endOfDay(report.reportDate);

    const empId = String((report.userId as any)?._id || report.userId);

    const [tasks, sessions, attendance] = await Promise.all([
      Task.find({
        assignedTo: empId,
        $or: [
          { createdAt: { $gte: s, $lte: e } },
          { updatedAt: { $gte: s, $lte: e } },
          { completedAt: { $gte: s, $lte: e } },
        ],
      })
        .populate("assignedTo", "_id fullName employeeId")
        .lean(),
      TaskTimeSession.find({
        userId: empId,
        startedAt: { $gte: s, $lte: e },
      })
        .populate("taskId", "_id title priority")
        .sort({ startedAt: 1 })
        .lean(),
      Attendance.findOne({
        userId: empId,
        date: { $gte: s, $lte: e },
      }).lean(),
    ]);

    return {
      reportId: report.reportId,
      reportDate: report.reportDate,
      status: report.status,
      reviewHistory: report.reviewHistory,
      tasks,
      workSessions: sessions,
      attendance,
    };
  }

  /**
   * 8. LIST SCOPED REPORTS
   */
  static async listReports(authUser: any, filters: Record<string, any> = {}) {
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
   * 9. SUMMARY / DASHBOARD METRICS
   */
  static async getSummary(authUser: any, date = new Date()) {
    const s = startOfDay(date);
    const e = endOfDay(date);

    const listResult = await this.listReports(authUser, {
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

    let totalCompletionSum = 0;
    let totalScoreSum = 0;
    let totalWorkedMinutes = 0;

    for (const r of reports) {
      if (r.status === "DRAFT") draftCount++;
      else if (r.status === "TEAM_LEAD_REVIEW") teamLeadReviewCount++;
      else if (r.status === "MANAGER_REVIEW") managerReviewCount++;
      else if (r.status === "APPROVED" || r.status === "REVIEWED") approvedCount++;
      else if (r.status === "REWORK_REQUIRED" || r.status === "RETURNED") reworkCount++;
      else submittedCount++;

      totalCompletionSum += Number(r.completionPercentage || 0);
      totalScoreSum += Number(r.performanceScore || 0);
      totalWorkedMinutes += Number(r.totalWorkedMinutes || 0);
    }

    const count = reports.length || 1;

    return {
      date: s.toISOString().split("T")[0],
      totalReports: reports.length,
      counts: {
        draftCount,
        submittedCount,
        teamLeadReviewCount,
        managerReviewCount,
        approvedCount,
        reworkCount,
      },
      averages: {
        avgCompletionPercentage: Math.round(totalCompletionSum / count),
        avgPerformanceScore: Math.round(totalScoreSum / count),
        totalWorkedHours: Math.round((totalWorkedMinutes / 60) * 10) / 10,
      },
      reports,
    };
  }
}

export default DailyWorkReportService;
