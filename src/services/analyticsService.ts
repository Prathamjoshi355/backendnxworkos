import mongoose from "mongoose";
import Task, { ITask } from "../models/Task";
import TaskTimeSession from "../models/TaskTimeSession";
import Attendance from "../models/Attendance";
import DailyReport from "../models/DailyReport";
import { PerformanceSnapshot } from "../models/PerformanceSnapshot";
import User from "../models/User";
import Team from "../models/Team";
import Department from "../models/Department";
import Organization from "../models/Organization";
import { getManagementScope } from "../utils/scopeHelper";

export type DateRangeType = "TODAY" | "YESTERDAY" | "THIS_WEEK" | "LAST_7_DAYS" | "THIS_MONTH" | "CUSTOM_RANGE";

export type TaskHealthStatus = "ON_TRACK" | "AT_RISK" | "OVERDUE" | "BLOCKED" | "AWAITING_REVIEW" | "COMPLETED";

export type WorkloadStatus = "NORMAL" | "HIGH" | "OVERLOADED";

export interface IDateBounds {
  start: Date;
  end: Date;
  rangeType: DateRangeType;
}

export function resolveDateBounds(rangeType: string = "TODAY", customStart?: string, customEnd?: string): IDateBounds {
  const now = new Date();
  const normalizedType = rangeType.toUpperCase() as DateRangeType;

  let start = new Date(now);
  let end = new Date(now);

  switch (normalizedType) {
    case "YESTERDAY":
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end, rangeType: "YESTERDAY" };

    case "THIS_WEEK": {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end, rangeType: "THIS_WEEK" };
    }

    case "LAST_7_DAYS":
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end, rangeType: "LAST_7_DAYS" };

    case "THIS_MONTH":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end, rangeType: "THIS_MONTH" };

    case "CUSTOM_RANGE":
      if (customStart) start = new Date(customStart);
      if (customEnd) end = new Date(customEnd);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end, rangeType: "CUSTOM_RANGE" };

    case "TODAY":
    default:
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end, rangeType: "TODAY" };
  }
}

export function classifyTaskHealth(task: any): TaskHealthStatus {
  if (task.status === "COMPLETED") return "COMPLETED";
  if (task.status === "REVIEW") return "AWAITING_REVIEW";
  if (task.status === "REWORK") return "BLOCKED";

  const now = new Date();
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    if (due < now) return "OVERDUE";

    // Due within 24 hours and less than 50% completed
    const hoursLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursLeft <= 24 && Number(task.completionPercentage || 0) < 50) {
      return "AT_RISK";
    }
  }

  return "ON_TRACK";
}

export function classifyWorkload(metrics: {
  activeTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  estimatedMinutes: number;
}): WorkloadStatus {
  // Configurable thresholds
  if (metrics.activeTasks > 6 || metrics.overdueTasks > 2 || metrics.estimatedMinutes > 600) {
    return "OVERLOADED";
  }
  if (metrics.activeTasks >= 4 || metrics.estimatedMinutes > 420) {
    return "HIGH";
  }
  return "NORMAL";
}

export class AnalyticsService {
  /**
   * 1. TASK METRICS
   */
  static async getTaskMetrics(filter: Record<string, any>, bounds: IDateBounds) {
    const tasks = await Task.find({
      ...filter,
      $or: [
        { createdAt: { $gte: bounds.start, $lte: bounds.end } },
        { updatedAt: { $gte: bounds.start, $lte: bounds.end } },
        { completedAt: { $gte: bounds.start, $lte: bounds.end } },
        { status: { $in: ["IN_PROGRESS", "TODO", "ASSIGNED", "PAUSED", "REVIEW", "REWORK"] } },
      ],
    }).lean();

    let assigned = 0;
    let inProgress = 0;
    let completed = 0;
    let pending = 0;
    let overdue = 0;
    let awaitingReview = 0;
    let rework = 0;
    let onTrack = 0;
    let atRisk = 0;

    const healthBreakdown: Record<TaskHealthStatus, number> = {
      ON_TRACK: 0,
      AT_RISK: 0,
      OVERDUE: 0,
      BLOCKED: 0,
      AWAITING_REVIEW: 0,
      COMPLETED: 0,
    };

    const now = new Date();

    for (const t of tasks) {
      assigned++;
      const health = classifyTaskHealth(t);
      healthBreakdown[health]++;

      if (t.status === "COMPLETED") completed++;
      else if (t.status === "IN_PROGRESS") inProgress++;
      else if (t.status === "REVIEW") awaitingReview++;
      else if (t.status === "REWORK") rework++;
      else pending++;

      if (t.dueDate && new Date(t.dueDate) < now && !["COMPLETED", "CANCELLED"].includes(t.status)) {
        overdue++;
      }
    }

    const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;

    return {
      total: tasks.length,
      assigned,
      inProgress,
      completed,
      pending,
      overdue,
      awaitingReview,
      rework,
      completionRate,
      health: healthBreakdown,
    };
  }

  /**
   * 2. WORKLOAD METRICS
   */
  static async getWorkloadMetrics(userIds: string[], organizationId?: string) {
    if (userIds.length === 0) return [];

    const [users, activeTasks, todaySessions] = await Promise.all([
      User.find({ _id: { $in: userIds } })
        .select("_id fullName employeeId designation role teamId departmentId")
        .lean(),
      Task.find({
        assignedTo: { $in: userIds },
        status: { $in: ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK"] },
      }).lean(),
      TaskTimeSession.find({
        userId: { $in: userIds },
        startedAt: { $gte: resolveDateBounds("TODAY").start },
      }).lean(),
    ]);

    const tasksByUser = new Map<string, any[]>();
    for (const t of activeTasks) {
      const uId = String(t.assignedTo);
      if (!tasksByUser.has(uId)) tasksByUser.set(uId, []);
      tasksByUser.get(uId)!.push(t);
    }

    const sessionsByUser = new Map<string, number>();
    for (const s of todaySessions) {
      const uId = String(s.userId);
      const secs = Number((s as any).activeSeconds || 0);
      sessionsByUser.set(uId, (sessionsByUser.get(uId) || 0) + secs);
    }

    const now = new Date();

    return users.map((u) => {
      const uId = String(u._id);
      const userTasks = tasksByUser.get(uId) || [];
      const trackedMins = Math.round((sessionsByUser.get(uId) || 0) / 60);

      let estimatedMinutes = 0;
      let activeCount = 0;
      let pendingCount = 0;
      let overdueCount = 0;
      let dueTodayCount = 0;

      for (const t of userTasks) {
        estimatedMinutes += Number(t.estimatedMinutes || 0);
        if (t.status === "IN_PROGRESS") activeCount++;
        else pendingCount++;

        if (t.dueDate) {
          const due = new Date(t.dueDate);
          if (due < now) overdueCount++;
          else if (due.toDateString() === now.toDateString()) dueTodayCount++;
        }
      }

      const status = classifyWorkload({
        activeTasks: activeCount,
        pendingTasks: pendingCount,
        overdueTasks: overdueCount,
        estimatedMinutes,
      });

      return {
        user: {
          id: uId,
          fullName: u.fullName,
          employeeId: u.employeeId,
          designation: u.designation,
          role: u.role,
        },
        activeTasks: activeCount,
        pendingTasks: pendingCount,
        dueTodayTasks: dueTodayCount,
        overdueTasks: overdueCount,
        estimatedMinutes,
        trackedMinutesToday: trackedMins,
        workloadStatus: status,
      };
    });
  }

  /**
   * 3. EOD METRICS
   */
  static async getEodMetrics(filter: Record<string, any>, bounds: IDateBounds) {
    const reports = await DailyReport.find({
      ...filter,
      reportDate: { $gte: bounds.start, $lte: bounds.end },
    })
      .populate("userId", "_id fullName employeeId designation")
      .populate("reviewedBy", "_id fullName")
      .lean();

    let draftCount = 0;
    let submittedCount = 0;
    let approvedCount = 0;
    let returnedCount = 0;
    let totalWorkedMinutes = 0;

    const blockerSummary: any[] = [];

    for (const r of reports) {
      if (r.status === "DRAFT") draftCount++;
      else if (r.status === "SUBMITTED") submittedCount++;
      else if (r.status === "APPROVED" || r.status === "REVIEWED") approvedCount++;
      else if (r.status === "RETURNED" || r.status === "REWORK_REQUIRED") returnedCount++;

      totalWorkedMinutes += Number(r.totalWorkedMinutes || 0);

      if (Array.isArray(r.blockers)) {
        for (const b of r.blockers) {
          if (!b.resolved) {
            blockerSummary.push({
              reportId: r.reportId || String(r._id),
              user: r.userId,
              blocker: b,
            });
          }
        }
      }
    }

    return {
      totalReports: reports.length,
      draftCount,
      submittedCount,
      approvedCount,
      returnedCount,
      totalWorkedMinutes,
      unresolvedBlockers: blockerSummary,
    };
  }

  /**
   * 4. ATTENTION QUEUE GENERATOR
   */
  static async getAttentionQueue(scopeFilter: Record<string, any>, bounds: IDateBounds) {
    const items: any[] = [];
    const now = new Date();

    // A. Overdue Tasks
    const overdueTasks = await Task.find({
      ...scopeFilter,
      $or: [{ status: "OVERDUE" }, { dueDate: { $lt: now }, status: { $nin: ["COMPLETED", "CANCELLED"] } }],
    })
      .populate("assignedTo", "_id fullName employeeId designation")
      .limit(20)
      .lean();

    for (const t of overdueTasks) {
      items.push({
        id: `ATTN-TASK-OD-${t._id}`,
        type: "TASK_OVERDUE",
        severity: "HIGH",
        title: `Overdue Task: "${t.title}"`,
        reason: `Task was due on ${t.dueDate ? new Date(t.dueDate).toISOString().split("T")[0] : "earlier"} and is still ${t.status}`,
        target: {
          id: String(t._id),
          title: t.title,
          assignedTo: t.assignedTo,
          status: t.status,
          dueDate: t.dueDate,
        },
        createdAt: t.dueDate || t.updatedAt,
      });
    }

    // B. Tasks Awaiting Review
    const reviewTasks = await Task.find({
      ...scopeFilter,
      status: "REVIEW",
    })
      .populate("assignedTo", "_id fullName employeeId designation")
      .limit(20)
      .lean();

    for (const t of reviewTasks) {
      items.push({
        id: `ATTN-TASK-REV-${t._id}`,
        type: "TASK_AWAITING_REVIEW",
        severity: "MEDIUM",
        title: `Task Awaiting Review: "${t.title}"`,
        reason: `Submitted by ${(t.assignedTo as any)?.fullName || "Employee"} for sign-off`,
        target: {
          id: String(t._id),
          title: t.title,
          assignedTo: t.assignedTo,
          status: t.status,
        },
        createdAt: t.updatedAt,
      });
    }

    // C. Critical Blockers & Returned EOD Reports
    const criticalEod = await DailyReport.find({
      ...scopeFilter,
      reportDate: { $gte: bounds.start, $lte: bounds.end },
      $or: [
        { status: { $in: ["RETURNED", "REWORK_REQUIRED"] } },
        { "blockers.severity": { $in: ["HIGH", "CRITICAL"] } },
      ],
    })
      .populate("userId", "_id fullName employeeId designation")
      .limit(20)
      .lean();

    for (const r of criticalEod) {
      if (r.status === "RETURNED" || r.status === "REWORK_REQUIRED") {
        items.push({
          id: `ATTN-EOD-RET-${r._id}`,
          type: "EOD_RETURNED_FOR_REWORK",
          severity: "MEDIUM",
          title: `EOD Returned for Rework: ${(r.userId as any)?.fullName}`,
          reason: r.reworkReason || r.reviewRemarks || "Corrections requested",
          target: {
            id: String(r._id),
            reportId: r.reportId,
            user: r.userId,
            status: r.status,
          },
          createdAt: r.reviewedAt || r.updatedAt,
        });
      }

      if (Array.isArray(r.blockers)) {
        for (const b of r.blockers) {
          if (!b.resolved && (b.severity === "HIGH" || b.severity === "CRITICAL")) {
            items.push({
              id: `ATTN-BLK-${r._id}-${b.blockerId}`,
              type: "CRITICAL_BLOCKER",
              severity: b.severity,
              title: `Critical Blocker: "${b.title}"`,
              reason: b.description || `Reported by ${(r.userId as any)?.fullName}`,
              target: {
                reportId: r.reportId,
                user: r.userId,
                blocker: b,
              },
              createdAt: b.createdAt,
            });
          }
        }
      }
    }

    // Sort attention items by severity (CRITICAL > HIGH > MEDIUM)
    const severityWeight: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
    items.sort((a, b) => (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0));

    return items;
  }

  /**
   * 5. EMPLOYEE DASHBOARD
   */
  static async getEmployeeDashboard(user: any, dateRangeType: string = "TODAY") {
    const userId = String(user._id || user.id);
    const bounds = resolveDateBounds(dateRangeType);

    const [taskMetrics, todayAttendance, eodToday, myBlockers, upcomingTasks, snapshot] = await Promise.all([
      this.getTaskMetrics({ assignedTo: userId }, bounds),
      Attendance.findOne({
        userId,
        date: { $gte: bounds.start, $lte: bounds.end },
      }).lean(),
      DailyReport.findOne({
        userId,
        reportDate: { $gte: bounds.start, $lte: bounds.end },
      }).lean(),
      DailyReport.find({
        userId,
        "blockers.resolved": false,
      })
        .select("reportId blockers reportDate")
        .sort({ reportDate: -1 })
        .limit(5)
        .lean(),
      Task.find({
        assignedTo: userId,
        status: { $in: ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK"] },
      })
        .select("_id taskId title status priority dueDate completionPercentage estimatedMinutes actualMinutes")
        .sort({ dueDate: 1 })
        .limit(10)
        .lean(),
      PerformanceSnapshot.findOne({
        userId,
        periodType: "DAILY",
        periodStart: { $gte: bounds.start, $lte: bounds.end },
      }).lean(),
    ]);

    const activeBlockers: any[] = [];
    for (const rep of myBlockers) {
      if (Array.isArray(rep.blockers)) {
        for (const b of rep.blockers) {
          if (!b.resolved) {
            activeBlockers.push({
              reportId: rep.reportId || String(rep._id),
              blocker: b,
            });
          }
        }
      }
    }

    const attendanceMinutes = todayAttendance ? Math.round(Number(todayAttendance.totalWorkDuration || 0) / 60000) : 0;

    return {
      dateRange: bounds,
      tasksToday: taskMetrics,
      attendance: {
        status: todayAttendance?.attendanceStatus || (todayAttendance?.currentStatus === "ONLINE" ? "PRESENT" : "OFFLINE"),
        currentStatus: todayAttendance?.currentStatus || "OFFLINE",
        workedMinutes: attendanceMinutes,
        checkInTime: todayAttendance?.firstLoginAt || null,
        checkOutTime: todayAttendance?.lastLogoutAt || null,
      },
      eod: {
        status: eodToday?.status || "NOT_CREATED",
        reportId: eodToday?.reportId || null,
        submittedAt: eodToday?.submittedAt || null,
        reviewedAt: eodToday?.reviewedAt || null,
        reviewRemarks: eodToday?.reviewRemarks || eodToday?.reviewerRemarks || null,
        reworkReason: eodToday?.reworkReason || null,
      },
      performance: {
        score: snapshot?.performanceScore ?? (eodToday?.performanceScore ?? null),
        status: snapshot ? "CONFIRMED_SNAPSHOT" : eodToday ? "LIVE_ESTIMATE" : "NOT_AVAILABLE",
      },
      upcomingTasks: upcomingTasks.map((t) => ({
        ...t,
        health: classifyTaskHealth(t),
      })),
      activeBlockers,
    };
  }

  /**
   * 6. TEAM LEAD DASHBOARD
   */
  static async getTeamLeadDashboard(user: any, dateRangeType: string = "TODAY", targetTeamId?: string) {
    const scope = await getManagementScope(user);
    const bounds = resolveDateBounds(dateRangeType);

    const teamId = targetTeamId || scope.managedTeamIds[0] || user.teamId;
    if (!teamId) throw new Error("NO_ASSIGNED_TEAM");

    const team = await Team.findById(teamId)
      .populate("managerId", "_id fullName email employeeId designation")
      .populate("teamLeadId", "_id fullName email employeeId designation")
      .lean();

    if (!team) throw new Error("TEAM_NOT_FOUND");

    const teamMembers = await User.find({
      teamId: String(team._id),
      status: "ACTIVE",
    })
      .select("_id fullName employeeId designation role status")
      .lean();

    const memberIds = teamMembers.map((m) => String(m._id));

    const [taskMetrics, workload, eodMetrics, attentionQueue] = await Promise.all([
      this.getTaskMetrics({ assignedTo: { $in: memberIds } }, bounds),
      this.getWorkloadMetrics(memberIds, String(team.organizationId || "")),
      this.getEodMetrics({ userId: { $in: memberIds } }, bounds),
      this.getAttentionQueue({ assignedTo: { $in: memberIds } }, bounds),
    ]);

    return {
      dateRange: bounds,
      team: {
        id: String(team._id),
        name: team.name,
        code: team.code,
        teamLead: team.teamLeadId,
        manager: team.managerId,
        totalEmployees: teamMembers.length,
      },
      taskMetrics,
      workload,
      eodMetrics,
      attentionQueue,
    };
  }

  /**
   * 7. MANAGER DASHBOARD
   */
  static async getManagerDashboard(user: any, dateRangeType: string = "TODAY", selectedTeamId?: string) {
    const scope = await getManagementScope(user);
    const bounds = resolveDateBounds(dateRangeType);

    const managedTeams = await Team.find({
      managerId: String(user._id || user.id),
      status: "ACTIVE",
    })
      .populate("teamLeadId", "_id fullName email employeeId designation")
      .lean();

    const teamIds = managedTeams.map((t) => String(t._id));
    const scopedUserIds = scope.scopedUserIds;

    const activeFilterTeamIds = selectedTeamId ? [selectedTeamId] : teamIds;

    const scopedUsers = await User.find({
      teamId: { $in: activeFilterTeamIds },
      status: "ACTIVE",
    })
      .select("_id fullName employeeId designation role teamId")
      .lean();

    const scopedUserIdsActive = scopedUsers.map((u) => String(u._id));

    const [overallTasks, workload, eodMetrics, attentionQueue] = await Promise.all([
      this.getTaskMetrics({ assignedTo: { $in: scopedUserIdsActive } }, bounds),
      this.getWorkloadMetrics(scopedUserIdsActive, String(user.organizationId || "")),
      this.getEodMetrics({ userId: { $in: scopedUserIdsActive } }, bounds),
      this.getAttentionQueue({ assignedTo: { $in: scopedUserIdsActive } }, bounds),
    ]);

    // Team Comparison metrics
    const teamComparison = await Promise.all(
      managedTeams.map(async (t) => {
        const tId = String(t._id);
        const members = await User.find({ teamId: tId, status: "ACTIVE" }).select("_id").lean();
        const mIds = members.map((m) => String(m._id));

        const [tTasks, tEod, snapshots] = await Promise.all([
          this.getTaskMetrics({ assignedTo: { $in: mIds } }, bounds),
          this.getEodMetrics({ userId: { $in: mIds } }, bounds),
          PerformanceSnapshot.find({
            userId: { $in: mIds },
            periodType: "DAILY",
            periodStart: { $gte: bounds.start, $lte: bounds.end },
          }).lean(),
        ]);

        const avgScore =
          snapshots.length > 0
            ? Math.round(snapshots.reduce((sum, s) => sum + s.performanceScore, 0) / snapshots.length)
            : null;

        return {
          teamId: tId,
          teamName: t.name,
          teamCode: t.code,
          teamLead: (t.teamLeadId as any)?.fullName || "Unassigned",
          employeeCount: mIds.length,
          completionRate: tTasks.completionRate,
          overdueCount: tTasks.overdue,
          awaitingReviewCount: tTasks.awaitingReview,
          blockerCount: tEod.unresolvedBlockers.length,
          eodSubmittedCount: tEod.submittedCount + tEod.approvedCount,
          performanceScore: avgScore !== null ? avgScore : "N/A",
        };
      })
    );

    return {
      dateRange: bounds,
      organizationSummary: {
        totalTeams: managedTeams.length,
        totalTeamLeads: managedTeams.filter((t) => t.teamLeadId).length,
        totalEmployees: scopedUsers.length,
      },
      selectedTeamId: selectedTeamId || "ALL",
      overallTasks,
      teamComparison,
      workload,
      eodMetrics,
      attentionQueue,
    };
  }

  /**
   * 8. ADMIN DASHBOARD
   */
  static async getAdminDashboard(authUser: any, dateRangeType: string = "TODAY", filters: Record<string, any> = {}) {
    const orgId = String(authUser.organizationId || "");
    const bounds = resolveDateBounds(dateRangeType, filters.startDate, filters.endDate);

    const userQuery: Record<string, any> = { organizationId: orgId, role: { $ne: "SUPER_ADMIN" } };
    if (filters.departmentId) userQuery.departmentId = filters.departmentId;
    if (filters.teamId) userQuery.teamId = filters.teamId;
    if (filters.employeeId || filters.userId) userQuery._id = filters.employeeId || filters.userId;

    const scopedUsers = await User.find(userQuery).select("_id fullName role designation teamId departmentId").lean();
    const userIds = scopedUsers.map((u) => String(u._id));

    const taskQuery: Record<string, any> = { organizationId: orgId, assignedTo: { $in: userIds } };
    if (filters.status) taskQuery.status = filters.status;

    const [departments, teams, taskMetrics, workload, eodMetrics, attentionQueue] = await Promise.all([
      Department.find({ organizationId: orgId }).select("_id name code").lean(),
      Team.find({ organizationId: orgId }).select("_id name code departmentId managerId teamLeadId").lean(),
      this.getTaskMetrics(taskQuery, bounds),
      this.getWorkloadMetrics(userIds.slice(0, 30), orgId),
      this.getEodMetrics({ organizationId: orgId, userId: { $in: userIds } }, bounds),
      this.getAttentionQueue({ organizationId: orgId, assignedTo: { $in: userIds } }, bounds),
    ]);

    return {
      dateRange: bounds,
      organizationId: orgId,
      departments,
      teams,
      totalEmployees: scopedUsers.length,
      taskMetrics,
      workload,
      eodMetrics,
      attentionQueue,
    };
  }

  /**
   * 9. SUPER ADMIN DASHBOARD
   */
  static async getSuperAdminDashboard(authUser: any, dateRangeType: string = "TODAY", filters: Record<string, any> = {}) {
    const bounds = resolveDateBounds(dateRangeType, filters.startDate, filters.endDate);

    const orgs = await Organization.find({ status: "ACTIVE" }).select("_id name code tier").lean();

    const targetOrgId = filters.organizationId;
    const taskQuery: Record<string, any> = targetOrgId ? { organizationId: targetOrgId } : {};

    const [taskMetrics, eodMetrics, attentionQueue] = await Promise.all([
      this.getTaskMetrics(taskQuery, bounds),
      this.getEodMetrics(targetOrgId ? { organizationId: targetOrgId } : {}, bounds),
      this.getAttentionQueue(taskQuery, bounds),
    ]);

    const orgComparisons = await Promise.all(
      orgs.map(async (org) => {
        const oId = String(org._id);
        const [empCount, teamCount, oTasks, oEod] = await Promise.all([
          User.countDocuments({ organizationId: oId, status: "ACTIVE" }),
          Team.countDocuments({ organizationId: oId, status: "ACTIVE" }),
          this.getTaskMetrics({ organizationId: oId }, bounds),
          this.getEodMetrics({ organizationId: oId }, bounds),
        ]);

        return {
          organizationId: oId,
          name: org.name,
          code: (org as any).code || (org as any).legalName || org.name,
          tier: (org as any).tier || "STANDARD",
          totalEmployees: empCount,
          totalTeams: teamCount,
          taskCompletionRate: oTasks.completionRate,
          overdueTasks: oTasks.overdue,
          awaitingReviewTasks: oTasks.awaitingReview,
          eodSubmissionCount: oEod.submittedCount + oEod.approvedCount,
          unresolvedBlockers: oEod.unresolvedBlockers.length,
        };
      })
    );

    return {
      dateRange: bounds,
      selectedOrganizationId: targetOrgId || "ALL",
      organizations: orgs,
      overallTasks: taskMetrics,
      organizationComparisons: orgComparisons,
      eodMetrics,
      attentionQueue,
    };
  }
}

export default AnalyticsService;
