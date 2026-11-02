import mongoose from "mongoose";
import { PerformanceSnapshot, IPerformanceSnapshot } from "../models/PerformanceSnapshot";
import Task from "../models/Task";
import TaskTimeSession from "../models/TaskTimeSession";
import Attendance from "../models/Attendance";
import DailyReport from "../models/DailyReport";
import { recordAuditLog } from "./auditLogService";
import { emitPerformanceUpdated } from "../lib/socketEmitters";

export interface IPerformanceMetricsBreakdown {
  tasksAssigned: number;
  tasksCompleted: number;
  tasksPending: number;
  tasksSubmitted: number;
  tasksApproved: number;
  tasksRework: number;
  tasksOverdue: number;
  onTimeCompletionCount: number;
  blockerCount: number;
  workedMinutes: number;
  estimatedMinutes: number;
  actualMinutes: number;
  taskCompletionRate: number;
  onTimeCompletionRate: number;
  approvalRate: number;
  eodSubmissionRate: number;
  workTimeUtilization: number;
  reworkRate: number;
}

export interface IPerformanceScoreResult {
  userId: string;
  organizationId: string;
  reportDate: Date;
  metrics: IPerformanceMetricsBreakdown;
  scoreBreakdown: {
    taskCompletionScore: number;
    timelinessScore: number;
    approvalScore: number;
    eodSubmissionScore: number;
    productivityScore: number;
    reworkDeduction: number;
  };
  performanceScore: number;
  formulaDescription: string;
}

export class PerformanceScoreService {
  /**
   * Transparent Performance Scoring Formula:
   * -------------------------------------------------------------
   * 1. Task Completion (25% Weight):
   *    (tasksCompleted / max(1, tasksAssigned)) * 100
   *
   * 2. Timeliness / On-Time Rate (20% Weight):
   *    (onTimeCompletionCount / max(1, tasksCompleted)) * 100
   *
   * 3. Approval Rate (20% Weight):
   *    (tasksApproved / max(1, tasksApproved + tasksSubmitted)) * 100
   *
   * 4. EOD Submission Timeliness (15% Weight):
   *    100 if APPROVED or SUBMITTED, 50 if DRAFT, 0 if NOT SUBMITTED
   *
   * 5. Work Time Utilization (10% Weight):
   *    min(100, (workedMinutes / 480) * 100)  [Target: 8 hours = 480 mins]
   *
   * 6. Quality / Rework Penalty (10% Maximum Deduction):
   *    (tasksRework / max(1, tasksAssigned)) * 100
   *
   * Final Score = max(0, min(100, (Completion*0.25 + Timeliness*0.20 + Approval*0.20 + EOD*0.15 + Utilization*0.10 - Rework*0.10)))
   */
  static async calculateDailyPerformanceScore(
    userId: string,
    organizationId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<IPerformanceScoreResult> {
    const [tasks, sessions, attendance, eodReport] = await Promise.all([
      Task.find({
        assignedTo: userId,
        organizationId,
        $or: [
          { createdAt: { $gte: periodStart, $lte: periodEnd } },
          { updatedAt: { $gte: periodStart, $lte: periodEnd } },
          { completedAt: { $gte: periodStart, $lte: periodEnd } },
          { status: { $in: ["IN_PROGRESS", "TODO", "ASSIGNED", "PAUSED", "REVIEW", "REWORK"] } },
        ],
      }).lean(),
      TaskTimeSession.find({
        userId,
        startedAt: { $gte: periodStart, $lte: periodEnd },
      }).lean(),
      Attendance.findOne({
        userId,
        date: { $gte: periodStart, $lte: periodEnd },
      }).lean(),
      DailyReport.findOne({
        userId,
        reportDate: { $gte: periodStart, $lte: periodEnd },
      }).lean(),
    ]);

    let sessionSeconds = 0;
    for (const session of sessions) {
      sessionSeconds += Number((session as any).activeSeconds || 0);
      if ((session as any).status === "ACTIVE" && (session as any).startedAt) {
        sessionSeconds += Math.floor((Date.now() - new Date((session as any).startedAt).getTime()) / 1000);
      }
    }
    const sessionWorkedMinutes = Math.round(sessionSeconds / 60);
    const attendanceMinutes = attendance ? Math.round(Number(attendance.totalWorkDuration || 0) / 60000) : 0;
    const workedMinutes = Math.max(sessionWorkedMinutes, attendanceMinutes);

    let estimatedMinutes = 0;
    let actualMinutes = 0;
    let tasksCompleted = 0;
    let tasksSubmitted = 0;
    let tasksApproved = 0;
    let tasksRework = 0;
    let tasksPending = 0;
    let tasksOverdue = 0;
    let onTimeCompletionCount = 0;

    for (const task of tasks) {
      estimatedMinutes += Number(task.estimatedMinutes || 0);
      actualMinutes += Number(task.actualMinutes || 0);

      if (task.status === "COMPLETED") {
        tasksCompleted++;
        tasksApproved++;
        if (task.dueDate && task.completedAt) {
          if (new Date(task.completedAt) <= new Date(task.dueDate)) {
            onTimeCompletionCount++;
          }
        } else {
          onTimeCompletionCount++;
        }
      } else if (task.status === "REVIEW") {
        tasksSubmitted++;
        tasksPending++;
      } else if (task.status === "REWORK") {
        tasksRework++;
        tasksPending++;
      } else {
        tasksPending++;
      }

      if (task.dueDate && new Date(task.dueDate) < new Date() && !["COMPLETED", "CANCELLED"].includes(task.status)) {
        tasksOverdue++;
      }
    }

    const tasksAssigned = tasks.length;
    const blockerCount = eodReport?.blockers?.length || 0;

    // Component calculations
    const taskCompletionRate = tasksAssigned > 0 ? (tasksCompleted / tasksAssigned) * 100 : tasksCompleted > 0 ? 100 : 50;
    const onTimeCompletionRate = tasksCompleted > 0 ? (onTimeCompletionCount / tasksCompleted) * 100 : 100;
    const approvalRate = (tasksApproved + tasksSubmitted) > 0 ? (tasksApproved / (tasksApproved + tasksSubmitted)) * 100 : 100;

    let eodSubmissionRate = 0;
    if (eodReport) {
      if (["APPROVED", "SUBMITTED"].includes(eodReport.status)) {
        eodSubmissionRate = 100;
      } else if (eodReport.status === "DRAFT") {
        eodSubmissionRate = 50;
      } else if (["RETURNED", "REWORK_REQUIRED"].includes(eodReport.status)) {
        eodSubmissionRate = 60;
      }
    }

    const workTimeUtilization = Math.min(100, Math.round((workedMinutes / 480) * 100));
    const reworkRate = tasksAssigned > 0 ? (tasksRework / tasksAssigned) * 100 : 0;

    // Weighted Scores
    const taskCompletionScore = taskCompletionRate * 0.25;
    const timelinessScore = onTimeCompletionRate * 0.20;
    const approvalScore = approvalRate * 0.20;
    const eodSubmissionScore = eodSubmissionRate * 0.15;
    const productivityScore = workTimeUtilization * 0.10;
    const reworkDeduction = Math.min(10, reworkRate * 0.10);

    const rawScore = taskCompletionScore + timelinessScore + approvalScore + eodSubmissionScore + productivityScore - reworkDeduction;
    const performanceScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    const metrics: IPerformanceMetricsBreakdown = {
      tasksAssigned,
      tasksCompleted,
      tasksPending,
      tasksSubmitted,
      tasksApproved,
      tasksRework,
      tasksOverdue,
      onTimeCompletionCount,
      blockerCount,
      workedMinutes,
      estimatedMinutes,
      actualMinutes,
      taskCompletionRate: Math.round(taskCompletionRate),
      onTimeCompletionRate: Math.round(onTimeCompletionRate),
      approvalRate: Math.round(approvalRate),
      eodSubmissionRate: Math.round(eodSubmissionRate),
      workTimeUtilization,
      reworkRate: Math.round(reworkRate),
    };

    return {
      userId,
      organizationId,
      reportDate: periodStart,
      metrics,
      scoreBreakdown: {
        taskCompletionScore: Math.round(taskCompletionScore * 10) / 10,
        timelinessScore: Math.round(timelinessScore * 10) / 10,
        approvalScore: Math.round(approvalScore * 10) / 10,
        eodSubmissionScore: Math.round(eodSubmissionScore * 10) / 10,
        productivityScore: Math.round(productivityScore * 10) / 10,
        reworkDeduction: Math.round(reworkDeduction * 10) / 10,
      },
      performanceScore,
      formulaDescription: "Score = Completion(25%) + Timeliness(20%) + Approval(20%) + EOD(15%) + Utilization(10%) - Rework(10%)",
    };
  }

  /**
   * Generates and stores the immutable DailyPerformanceSnapshot
   */
  static async createDailyPerformanceSnapshot(
    userId: string,
    organizationId: string,
    reportDate: Date = new Date(),
    forceRegenerate: boolean = false
  ): Promise<IPerformanceSnapshot> {
    const periodStart = new Date(reportDate);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(reportDate);
    periodEnd.setHours(23, 59, 59, 999);

    const existing = await PerformanceSnapshot.findOne({
      userId,
      organizationId,
      periodType: "DAILY",
      periodStart: { $gte: periodStart, $lte: periodEnd },
    });

    if (existing && !forceRegenerate) {
      return existing;
    }

    const calculated = await this.calculateDailyPerformanceScore(userId, organizationId, periodStart, periodEnd);

    if (existing && forceRegenerate) {
      existing.performanceScore = calculated.performanceScore;
      existing.taskCompletionScore = calculated.metrics.taskCompletionRate;
      existing.timelinessScore = calculated.metrics.onTimeCompletionRate;
      existing.attendanceScore = calculated.metrics.workTimeUtilization;
      existing.targetScore = calculated.metrics.approvalRate;
      existing.consistencyScore = calculated.metrics.eodSubmissionRate;
      existing.productivityScore = calculated.metrics.workTimeUtilization;
      existing.calculatedAt = new Date();
      await existing.save();

      try {
        emitPerformanceUpdated(userId, existing, organizationId);
      } catch (e) {
        console.error("Error emitting performance event:", e);
      }

      await recordAuditLog({
        organizationId,
        actorId: userId,
        action: "PERFORMANCE_SNAPSHOT_REGENERATED",
        entityType: "PERFORMANCE_SNAPSHOT",
        entityId: String(existing._id),
        summary: `Regenerated performance snapshot for ${periodStart.toISOString().split("T")[0]}`,
      });

      return existing;
    }

    const snapshot = await PerformanceSnapshot.create({
      userId: new mongoose.Types.ObjectId(userId),
      organizationId: new mongoose.Types.ObjectId(organizationId),
      periodType: "DAILY",
      periodStart,
      periodEnd,
      performanceScore: calculated.performanceScore,
      taskCompletionScore: calculated.metrics.taskCompletionRate,
      timelinessScore: calculated.metrics.onTimeCompletionRate,
      attendanceScore: calculated.metrics.workTimeUtilization,
      targetScore: calculated.metrics.approvalRate,
      consistencyScore: calculated.metrics.eodSubmissionRate,
      productivityScore: calculated.metrics.workTimeUtilization,
      calculationVersion: 1,
      calculatedAt: new Date(),
    });

    try {
      emitPerformanceUpdated(userId, snapshot, organizationId);
    } catch (e) {
      console.error("Error emitting performance event:", e);
    }

    await recordAuditLog({
      organizationId,
      actorId: userId,
      action: "PERFORMANCE_SNAPSHOT_GENERATED",
      entityType: "PERFORMANCE_SNAPSHOT",
      entityId: String(snapshot._id),
      summary: `Generated daily performance snapshot (Score: ${calculated.performanceScore}) for ${periodStart.toISOString().split("T")[0]}`,
    });

    return snapshot;
  }
}

export default PerformanceScoreService;
