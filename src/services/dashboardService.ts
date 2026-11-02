import mongoose from "mongoose";
import User from "../models/User";
import Attendance from "../models/Attendance";
import WorkSession from "../models/WorkSession";
import AttendanceBreak from "../models/Break";
import Task from "../models/Task";
import DailyReport from "../models/DailyReport";
import Leave from "../models/Leave";
import Project from "../models/Project";
import Meeting from "../models/Meeting";
import Conversation from "../models/Conversation";
import { PerformanceSnapshot } from "../models/PerformanceSnapshot";
import PointTransaction from "../models/PointTransaction";
import Organization from "../models/Organization";
import { parseReportDateRange } from "../utils/dateRangeHelper";
import { getManagementScope } from "../utils/scopeHelper";
import * as reportService from "./reportService";
import * as notificationService from "./notificationService";
import { getLiveAttendance } from "./attendanceService";

export interface DashboardAlert {
  id: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  message: string;
  targetModule: string;
  actionLabel: string;
}

export interface DashboardQuickAction {
  id: string;
  label: string;
  icon: string;
  targetModule: string;
  actionKey: string;
}

function formatMinutes(msOrMinutes: number, isMs = false): string {
  const mins = isMs ? Math.round(msOrMinutes / 60000) : Math.round(msOrMinutes);
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Authoritative Dashboard Orchestration Service.
 * Consumes canonical domain & report services without duplicating KPI engines.
 */
export async function getDashboard(authUser: any, query: Record<string, any> = {}) {
  const userId = String(authUser._id || authUser.id);
  const effectiveRole = String(query.roleOverride || authUser.role || "EMPLOYEE").toUpperCase();
  const scope = await getManagementScope(authUser);

  // Determine default period: 'today' for employee, 'this_month' for manager/admin/super-admin
  const defaultPeriod = effectiveRole === "EMPLOYEE" || effectiveRole === "INTERN" ? "today" : "this_month";
  const periodPreset = (query.period || query.dateRange || query.range || defaultPeriod).toLowerCase();
  const dateRange = parseReportDateRange(periodPreset, query.startDate, query.endDate);

  // Base Executive / Overview metrics from authoritative reportService
  const overviewReport = await reportService.getOverviewReport(authUser, {
    dateRange: periodPreset,
    startDate: query.startDate,
    endDate: query.endDate,
    departmentId: query.departmentId,
    teamId: query.teamId,
    projectId: query.projectId,
    organizationId: query.organizationId,
  });

  // Fetch real notifications via canonical notificationService
  const unreadNotificationCount = await notificationService.getUnreadCount(userId).catch(() => 0);
  const recentNotificationsRes = await notificationService.getUserNotifications(userId, { limit: 5 }).catch(() => ({ items: [] }));
  const notificationsData = {
    unreadCount: unreadNotificationCount,
    recent: recentNotificationsRes.items || [],
  };

  const alerts: DashboardAlert[] = [];
  const quickActions: DashboardQuickAction[] = [];

  // ==========================================
  // 1. EMPLOYEE TIER
  // ==========================================
  if (effectiveRole === "EMPLOYEE" || effectiveRole === "INTERN") {
    const todayBounds = getTodayBounds();

    // Sourced directly from live Attendance, WorkSession, and Breaks
    const todayAttendance = await Attendance.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      date: { $gte: todayBounds.start, $lte: todayBounds.end },
    }).lean();

    const activeSession = await WorkSession.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: "ACTIVE",
    }).lean();

    const activeBreak = await AttendanceBreak.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: "ACTIVE",
    }).lean();

    const currentWorkStatus = activeBreak ? "ON_BREAK" : activeSession ? "ONLINE" : "OFFLINE";

    const todayWork = {
      workStatus: currentWorkStatus,
      attendanceStatus: todayAttendance?.attendanceStatus || "ABSENT",
      firstLoginAt: todayAttendance?.firstLoginAt || null,
      lastLogoutAt: todayAttendance?.lastLogoutAt || null,
      totalWorkDuration: todayAttendance?.totalWorkDuration || 0,
      totalBreakDuration: todayAttendance?.totalBreakDuration || 0,
      workDurationText: formatMinutes(todayAttendance?.totalWorkDuration || 0, true),
      breakDurationText: formatMinutes(todayAttendance?.totalBreakDuration || 0, true),
      hasActiveSession: !!activeSession,
      hasActiveBreak: !!activeBreak,
      activeTimerStartedAt: activeSession?.loginAt || null,
    };

    // Employee tasks
    const userTasks = await Task.find({
      assignedTo: new mongoose.Types.ObjectId(userId),
      isDeleted: { $ne: true },
    })
      .sort({ dueDate: 1, priority: -1 })
      .limit(50)
      .lean();

    const now = new Date();
    const overdueTasks = userTasks.filter(
      (t) => t.dueDate && new Date(t.dueDate) < now && !["COMPLETED", "CANCELLED"].includes(t.status)
    );
    const inProgressTasks = userTasks.filter((t) => t.status === "IN_PROGRESS");
    const pendingTasks = userTasks.filter((t) =>
      ["PENDING", "ASSIGNED", "IN_PROGRESS", "REVIEW", "REWORK"].includes(t.status)
    );
    const completedTasks = userTasks.filter((t) => t.status === "COMPLETED");
    const reworkTasks = userTasks.filter((t) => t.status === "REWORK");

    const tasksSummary = {
      total: userTasks.length,
      pending: pendingTasks.length,
      inProgress: inProgressTasks.length,
      overdue: overdueTasks.length,
      completed: completedTasks.length,
      rework: reworkTasks.length,
      completionRate: userTasks.length > 0 ? Math.round((completedTasks.length / userTasks.length) * 100) : 100,
      priorities: userTasks
        .filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status))
        .slice(0, 5)
        .map((t) => ({
          id: String(t._id),
          taskId: t.taskId || String(t._id),
          title: t.title,
          priority: t.priority || "MEDIUM",
          status: t.status,
          dueDate: t.dueDate,
          isOverdue: t.dueDate ? new Date(t.dueDate) < now : false,
        })),
    };

    // Performance & Points
    const latestSnapshot = await PerformanceSnapshot.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .sort({ reportDate: -1 })
      .lean();

    const pointsAgg = await PointTransaction.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalEarned: {
            $sum: { $cond: [{ $eq: ["$type", "EARNED"] }, "$points", 0] },
          },
          totalDeducted: {
            $sum: { $cond: [{ $eq: ["$type", "DEDUCTED"] }, "$points", 0] },
          },
        },
      },
    ]);

    const netPoints = pointsAgg.length > 0 ? (pointsAgg[0].totalEarned || 0) - (pointsAgg[0].totalDeducted || 0) : 0;

    // Today's EOD
    const todayEod = await DailyReport.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      reportDate: { $gte: todayBounds.start, $lte: todayBounds.end },
    }).lean();

    const performanceData = {
      score: latestSnapshot?.performanceScore != null ? Math.round(latestSnapshot.performanceScore) : 100,
      points: netPoints,
      taskCompletionRate: latestSnapshot?.taskCompletionScore ?? tasksSummary.completionRate,
      approvalRate: 100,
      eodStatus: todayEod ? todayEod.status : "NOT_SUBMITTED",
      eodSubmitted: !!todayEod,
    };

    // Leaves
    const userLeaves = await Leave.find({
      userId: new mongoose.Types.ObjectId(userId),
      status: { $in: ["PENDING", "APPROVED"] },
    })
      .sort({ startDate: 1 })
      .limit(5)
      .lean();

    const pendingLeaves = userLeaves.filter((l) => l.status === "PENDING");
    const upcomingLeaves = userLeaves.filter((l) => l.status === "APPROVED" && new Date(l.endDate) >= todayBounds.start);

    // Projects assigned
    const userProjects = await Project.find({
      $or: [
        { ownerId: new mongoose.Types.ObjectId(userId) },
        { members: new mongoose.Types.ObjectId(userId) },
      ],
      status: { $ne: "CANCELLED" },
    })
      .sort({ dueDate: 1 })
      .limit(5)
      .lean();

    // Today & upcoming meetings
    const userMeetings = await Meeting.find({
      $or: [
        { organizerId: new mongoose.Types.ObjectId(userId) },
        { "participants.userId": new mongoose.Types.ObjectId(userId) },
      ],
      date: { $gte: todayBounds.start },
      status: { $ne: "CANCELLED" },
    })
      .sort({ date: 1, startTime: 1 })
      .limit(5)
      .lean();

    // Communication: Unread conversations
    const userConversations = await Conversation.find({
      participants: new mongoose.Types.ObjectId(userId),
      isArchived: { $ne: true },
    })
      .sort({ lastMessageAt: -1 })
      .limit(5)
      .lean();

    const unreadConvCount = userConversations.filter(
      (c) => c.unreadCounts && (c.unreadCounts as any)[userId] && Number((c.unreadCounts as any)[userId]) > 0
    ).length;

    // Generate Deterministic Alerts
    if (overdueTasks.length > 0) {
      alerts.push({
        id: "alert-emp-overdue",
        severity: "CRITICAL",
        title: `${overdueTasks.length} Overdue ${overdueTasks.length === 1 ? "Task" : "Tasks"}`,
        message: "You have tasks past their due date requiring immediate attention.",
        targetModule: "tasks",
        actionLabel: "View Overdue Tasks",
      });
    }

    if (!todayEod) {
      alerts.push({
        id: "alert-emp-eod",
        severity: "WARNING",
        title: "Daily EOD Report Pending",
        message: "Your daily work report has not yet been submitted for today.",
        targetModule: "eod",
        actionLabel: "Submit EOD Report",
      });
    }

    if (reworkTasks.length > 0) {
      alerts.push({
        id: "alert-emp-rework",
        severity: "WARNING",
        title: `${reworkTasks.length} ${reworkTasks.length === 1 ? "Task" : "Tasks"} in Rework`,
        message: "Task has been returned with feedback requiring revisions.",
        targetModule: "tasks",
        actionLabel: "View Rework Tasks",
      });
    }

    if (userMeetings.length > 0) {
      const nextMeeting = userMeetings[0];
      alerts.push({
        id: "alert-emp-meeting",
        severity: "INFO",
        title: `Upcoming Meeting: ${nextMeeting.title}`,
        message: `Scheduled today at ${nextMeeting.startTime}.`,
        targetModule: "meetings",
        actionLabel: "Open Meetings",
      });
    }

    // Quick Actions
    if (currentWorkStatus === "OFFLINE") {
      quickActions.push({ id: "qa-login", label: "Check In", icon: "login", targetModule: "attendance", actionKey: "check_in" });
    } else if (currentWorkStatus === "ONLINE") {
      quickActions.push({ id: "qa-break", label: "Start Break", icon: "pause", targetModule: "attendance", actionKey: "start_break" });
      quickActions.push({ id: "qa-logout", label: "Check Out", icon: "logout", targetModule: "attendance", actionKey: "check_out" });
    } else if (currentWorkStatus === "ON_BREAK") {
      quickActions.push({ id: "qa-endbreak", label: "End Break", icon: "play_arrow", targetModule: "attendance", actionKey: "end_break" });
    }

    quickActions.push({ id: "qa-tasks", label: "My Tasks", icon: "assignment", targetModule: "tasks", actionKey: "view_tasks" });
    if (!todayEod) {
      quickActions.push({ id: "qa-eod", label: "Submit EOD", icon: "assignment_turned_in", targetModule: "eod", actionKey: "submit_eod" });
    }
    quickActions.push({ id: "qa-leave", label: "Request Leave", icon: "beach_access", targetModule: "leaves", actionKey: "request_leave" });
    quickActions.push({ id: "qa-chat", label: "Messages", icon: "chat", targetModule: "chat", actionKey: "open_chat" });

    return {
      role: effectiveRole,
      scope: { level: "PERSONAL", userId },
      period: { start: dateRange.current.start, end: dateRange.current.end, preset: periodPreset },
      overview: overviewReport,
      kpis: [
        { label: "Today Attendance", value: todayWork.attendanceStatus, delta: null, unit: "" },
        { label: "Tasks Pending", value: tasksSummary.pending, delta: null, unit: "" },
        { label: "Tasks Overdue", value: tasksSummary.overdue, delta: null, unit: "" },
        { label: "Performance Score", value: `${performanceData.score}/100`, delta: null, unit: "" },
        { label: "My Points", value: performanceData.points, delta: null, unit: "pts" },
        { label: "EOD Status", value: performanceData.eodStatus, delta: null, unit: "" },
      ],
      alerts,
      todayWork,
      tasks: tasksSummary,
      performance: performanceData,
      leave: {
        pendingCount: pendingLeaves.length,
        upcomingCount: upcomingLeaves.length,
        items: userLeaves.map((l) => ({
          id: String(l._id),
          leaveTypeName: l.leaveTypeName,
          startDate: l.startDate,
          endDate: l.endDate,
          totalDays: l.totalDays,
          status: l.status,
        })),
      },
      projects: userProjects.map((p) => ({
        id: String(p._id),
        projectId: p.projectId,
        name: p.name,
        status: p.status,
        progress: p.progress || 0,
        dueDate: p.dueDate,
      })),
      meetings: userMeetings.map((m) => ({
        id: String(m._id),
        meetingId: m.meetingId,
        title: m.title,
        startTime: m.startTime,
        endTime: m.endTime,
        date: m.date,
        location: m.location,
        meetingLink: m.meetingLink,
      })),
      communication: {
        unreadConversations: unreadConvCount,
        recent: userConversations.slice(0, 3).map((c) => ({
          id: String(c._id),
          name: c.name || "Conversation",
          type: c.type,
          lastMessageAt: c.lastMessageAt,
          unreadCount: (c.unreadCounts && (c.unreadCounts as any)[userId]) || 0,
        })),
      },
      notifications: notificationsData,
      quickActions,
    };
  }

  // ==========================================
  // 2. ADMIN / MANAGER TIER
  // ==========================================
  if (effectiveRole === "ADMIN" || effectiveRole === "MANAGER" || effectiveRole === "TEAM_LEADER") {
    const orgId = authUser.organizationId ? String(authUser.organizationId) : null;
    const orgQuery: Record<string, any> = {};
    if (orgId) orgQuery.organizationId = new mongoose.Types.ObjectId(orgId);

    // Manager / team scope
    if ((effectiveRole === "MANAGER" || effectiveRole === "TEAM_LEADER") && scope.managedTeamIds.length > 0) {
      orgQuery.teamId = { $in: scope.managedTeamIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    // Live workforce attendance telemetry (getLiveAttendance returns array directly)
    const liveItems = (await getLiveAttendance({
      organizationId: orgId,
      teamIds: scope.managedTeamIds.length > 0 ? scope.managedTeamIds : undefined,
    }).catch(() => [])) as any[];

    const onlineCount = liveItems.filter((i: any) => i.currentStatus === "ONLINE").length;
    const onBreakCount = liveItems.filter((i: any) => i.currentStatus === "ON_BREAK").length;
    const offlineCount = liveItems.filter((i: any) => i.currentStatus === "OFFLINE" || i.currentStatus === "LOGGED_OUT").length;
    const lateCount = liveItems.filter((i: any) => i.attendanceStatus === "LATE").length;
    const presentCount = liveItems.filter((i: any) => ["PRESENT", "LATE", "HALF_DAY"].includes(i.attendanceStatus)).length;

    // Task Operations
    const taskMatch: Record<string, any> = { isDeleted: { $ne: true } };
    if (orgId) taskMatch.organizationId = new mongoose.Types.ObjectId(orgId);
    if (scope.managedTeamIds.length > 0) {
      taskMatch.teamId = { $in: scope.managedTeamIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    const taskCounts = await Task.aggregate([
      { $match: taskMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const taskMap = new Map(taskCounts.map((t) => [t._id, t.count]));
    const totalTasks = Array.from(taskMap.values()).reduce((acc, c) => acc + c, 0);
    const pendingTasks = (taskMap.get("PENDING") || 0) + (taskMap.get("ASSIGNED") || 0);
    const inProgressTasks = taskMap.get("IN_PROGRESS") || 0;
    const completedTasks = taskMap.get("COMPLETED") || 0;
    const reworkTasks = taskMap.get("REWORK") || 0;
    const reviewTasks = taskMap.get("REVIEW") || 0;

    const overdueCount = await Task.countDocuments({
      ...taskMatch,
      dueDate: { $lt: new Date() },
      status: { $nin: ["COMPLETED", "CANCELLED"] },
    });

    // Team Performance Snapshots
    const userMatch: Record<string, any> = { status: { $nin: ["DELETED", "TERMINATED", "EXITED"] } };
    if (orgId) userMatch.organizationId = new mongoose.Types.ObjectId(orgId);
    if (scope.managedTeamIds.length > 0) {
      userMatch.teamId = { $in: scope.managedTeamIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    const teamUsers = await User.find(userMatch).select("fullName employeeId role designation teamId").lean();
    const teamUserIds = teamUsers.map((u) => u._id);

    const latestSnapshots = await PerformanceSnapshot.aggregate([
      { $match: { userId: { $in: teamUserIds } } },
      { $sort: { reportDate: -1 } },
      {
        $group: {
          _id: "$userId",
          latestScore: { $first: "$performanceScore" },
          reportDate: { $first: "$reportDate" },
        },
      },
    ]);

    const scoreMap = new Map(latestSnapshots.map((s) => [String(s._id), Math.round(s.latestScore)]));
    const scoredUsers = teamUsers.map((u) => ({
      userId: String(u._id),
      name: u.fullName,
      employeeId: u.employeeId,
      role: u.designation || u.role,
      score: scoreMap.get(String(u._id)) ?? 100,
    }));

    scoredUsers.sort((a, b) => b.score - a.score);
    const topPerformers = scoredUsers.slice(0, 3);
    const attentionNeeded = scoredUsers.filter((u) => u.score < 60);

    const avgScore =
      scoredUsers.length > 0
        ? Math.round(scoredUsers.reduce((acc, u) => acc + u.score, 0) / scoredUsers.length)
        : 100;

    // EOD Compliance
    const todayBounds = getTodayBounds();
    const todayEodSubmissions = await DailyReport.find({
      userId: { $in: teamUserIds },
      reportDate: { $gte: todayBounds.start, $lte: todayBounds.end },
    }).lean();

    const pendingEodApprovals = todayEodSubmissions.filter((e) => e.status === "SUBMITTED");
    const approvedEod = todayEodSubmissions.filter((e) => e.status === "APPROVED");
    const eodComplianceRate =
      teamUsers.length > 0 ? Math.round((todayEodSubmissions.length / teamUsers.length) * 100) : 100;

    // Leave Operations
    const pendingLeaveRequests = await Leave.find({
      organizationId: orgId ? new mongoose.Types.ObjectId(orgId) : { $exists: true },
      userId: { $in: teamUserIds },
      status: "PENDING",
    })
      .populate("userId", "fullName employeeId designation")
      .limit(10)
      .lean();

    // Projects status
    const activeProjects = await Project.find({
      organizationId: orgId ? new mongoose.Types.ObjectId(orgId) : { $exists: true },
      status: { $in: ["ACTIVE", "PLANNED"] },
    })
      .sort({ dueDate: 1 })
      .limit(5)
      .lean();

    const delayedProjects = activeProjects.filter(
      (p) => p.dueDate && new Date(p.dueDate) < new Date() && (p.progress || 0) < 100
    );

    // HR Operations Highlights (strictly non-confidential)
    const probationEmployees = await User.countDocuments({
      ...userMatch,
      status: "PROBATION",
    });

    const noticePeriodEmployees = await User.countDocuments({
      ...userMatch,
      status: "NOTICE_PERIOD",
    });

    // Deterministic Operational Alerts
    if (pendingLeaveRequests.length > 0) {
      alerts.push({
        id: "alert-admin-leaves",
        severity: "WARNING",
        title: `${pendingLeaveRequests.length} Pending Leave ${pendingLeaveRequests.length === 1 ? "Request" : "Requests"}`,
        message: "Team members are awaiting manager approval on pending leave requests.",
        targetModule: "leaves",
        actionLabel: "Review Leave Requests",
      });
    }

    if (overdueCount > 0) {
      alerts.push({
        id: "alert-admin-overdue",
        severity: "CRITICAL",
        title: `${overdueCount} Overdue Team Tasks`,
        message: "Tasks across your management scope have exceeded their committed deadlines.",
        targetModule: "tasks",
        actionLabel: "Inspect Overdue Tasks",
      });
    }

    if (delayedProjects.length > 0) {
      alerts.push({
        id: "alert-admin-projects",
        severity: "CRITICAL",
        title: `${delayedProjects.length} Active ${delayedProjects.length === 1 ? "Project" : "Projects"} Past Due Date`,
        message: "Projects have crossed their targeted deadline without completion.",
        targetModule: "projects",
        actionLabel: "Review Project Deadlines",
      });
    }

    if (pendingEodApprovals.length > 0) {
      alerts.push({
        id: "alert-admin-eod",
        severity: "INFO",
        title: `${pendingEodApprovals.length} EOD ${pendingEodApprovals.length === 1 ? "Report" : "Reports"} Awaiting Approval`,
        message: "Team daily work reports submitted and pending administrative review.",
        targetModule: "eod",
        actionLabel: "Review EOD Reports",
      });
    }

    // Quick Actions
    quickActions.push({ id: "qa-live", label: "Live Telemetry", icon: "sensors", targetModule: "live-monitoring", actionKey: "live_monitoring" });
    quickActions.push({ id: "qa-tasks", label: "Assign Task", icon: "assignment", targetModule: "tasks", actionKey: "assign_task" });
    quickActions.push({ id: "qa-leaves", label: "Review Leaves", icon: "beach_access", targetModule: "leaves", actionKey: "review_leaves" });
    quickActions.push({ id: "qa-eod", label: "Review EOD", icon: "assignment_turned_in", targetModule: "eod", actionKey: "review_eod" });
    quickActions.push({ id: "qa-reports", label: "Executive Reports", icon: "bar_chart", targetModule: "reports", actionKey: "view_reports" });

    const totalEmpDelta = (overviewReport.kpis?.totalEmployees as any)?.delta?.percentage ?? 0;

    return {
      role: effectiveRole,
      scope: { level: scope.isManager ? "TEAM" : "ORGANIZATION", organizationId: orgId, managedTeamIds: scope.managedTeamIds },
      period: { start: dateRange.current.start, end: dateRange.current.end, preset: periodPreset },
      overview: overviewReport,
      kpis: [
        { label: "Total Workforce", value: teamUsers.length, delta: totalEmpDelta, unit: "people" },
        { label: "Online Now", value: onlineCount, delta: null, unit: "working" },
        { label: "On Break", value: onBreakCount, delta: null, unit: "resting" },
        { label: "Late Today", value: lateCount, delta: null, unit: "delayed" },
        { label: "Tasks Overdue", value: overdueCount, delta: null, unit: "tasks" },
        { label: "Avg Performance", value: `${avgScore}/100`, delta: null, unit: "" },
        { label: "EOD Compliance", value: `${eodComplianceRate}%`, delta: null, unit: "" },
      ],
      alerts,
      workforce: {
        total: teamUsers.length,
        online: onlineCount,
        onBreak: onBreakCount,
        offline: offlineCount,
        late: lateCount,
        present: presentCount,
      },
      taskOperations: {
        total: totalTasks,
        pending: pendingTasks,
        inProgress: inProgressTasks,
        completed: completedTasks,
        overdue: overdueCount,
        review: reviewTasks,
        rework: reworkTasks,
      },
      teamPerformance: {
        averageScore: avgScore,
        topPerformers,
        attentionNeeded,
      },
      eodOperations: {
        submittedToday: todayEodSubmissions.length,
        pendingApproval: pendingEodApprovals.length,
        approved: approvedEod.length,
        complianceRate: eodComplianceRate,
      },
      leaveOperations: {
        pendingCount: pendingLeaveRequests.length,
        pendingRequests: pendingLeaveRequests.map((l: any) => ({
          id: String(l._id),
          employeeName: l.userId?.fullName || "Employee",
          leaveTypeName: l.leaveTypeName,
          totalDays: l.totalDays,
          startDate: l.startDate,
          endDate: l.endDate,
        })),
      },
      projects: activeProjects.map((p) => ({
        id: String(p._id),
        projectId: p.projectId,
        name: p.name,
        progress: p.progress || 0,
        status: p.status,
        dueDate: p.dueDate,
        isDelayed: p.dueDate ? new Date(p.dueDate) < new Date() && (p.progress || 0) < 100 : false,
      })),
      hr: {
        probationCount: probationEmployees,
        noticePeriodCount: noticePeriodEmployees,
      },
      notifications: notificationsData,
      quickActions,
    };
  }

  // ==========================================
  // 3. SUPER ADMIN EXECUTIVE TIER
  // ==========================================
  const allOrganizations = await Organization.find({ status: { $ne: "DELETED" } })
    .select("name status createdAt")
    .lean();

  const totalOrgs = allOrganizations.length;
  const targetOrgId = query.organizationId ? String(query.organizationId) : undefined;

  // Multi-organization comparative metrics
  const orgSummaries = await Promise.all(
    allOrganizations.map(async (org) => {
      const orgId = org._id;
      const [userCount, activeCount, taskCount, completedCount, activeProjectsCount] = await Promise.all([
        User.countDocuments({ organizationId: orgId, status: { $ne: "DELETED" } }),
        User.countDocuments({ organizationId: orgId, status: "ACTIVE" }),
        Task.countDocuments({ organizationId: orgId, isDeleted: { $ne: true } }),
        Task.countDocuments({ organizationId: orgId, status: "COMPLETED", isDeleted: { $ne: true } }),
        Project.countDocuments({ organizationId: orgId, status: "ACTIVE" }),
      ]);

      const completionRate = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 100;

      return {
        organizationId: String(org._id),
        name: org.name,
        code: (org as any).code || String(org.name).substring(0, 3).toUpperCase(),
        status: org.status,
        headcount: userCount,
        activeWorkforce: activeCount,
        totalTasks: taskCount,
        taskCompletionRate: completionRate,
        activeProjects: activeProjectsCount,
      };
    })
  );

  // Cross-org alerts
  const organizationsWithLowTasks = orgSummaries.filter((o) => o.headcount > 0 && o.taskCompletionRate < 50);
  if (organizationsWithLowTasks.length > 0) {
    alerts.push({
      id: "alert-super-completion",
      severity: "WARNING",
      title: `${organizationsWithLowTasks.length} Organizations with Low Task Completion (<50%)`,
      message: "Multiple tenant organizations exhibit task completion rates under organizational standard.",
      targetModule: "reports",
      actionLabel: "Inspect Reports",
    });
  }

  // Compensation Cost Summary (Strictly authorized for Super Admin)
  let compensationSummary: any = null;
  try {
    const compQueryParams: Record<string, string> = {};
    if (targetOrgId) compQueryParams.organizationId = targetOrgId;
    const compReport = await reportService.getCompensationReport(authUser, compQueryParams);
    compensationSummary = {
      ...compReport.summary,
      monthlyPayrollCost: compReport.summary?.totalMonthlyPayroll ?? 0,
    };
  } catch {
    compensationSummary = null;
  }

  // Quick Actions for Super Admin
  quickActions.push({ id: "qa-super-orgs", label: "Manage Orgs", icon: "apartment", targetModule: "organizations", actionKey: "manage_orgs" });
  quickActions.push({ id: "qa-super-access", label: "Access Control", icon: "security", targetModule: "access-control", actionKey: "manage_access" });
  quickActions.push({ id: "qa-super-reports", label: "Platform Reports", icon: "bar_chart", targetModule: "reports", actionKey: "view_reports" });
  quickActions.push({ id: "qa-super-audit", label: "Audit Logs", icon: "history", targetModule: "audit-logs", actionKey: "view_audit_logs" });

  const totalEmp = (overviewReport.kpis?.totalEmployees as any)?.current ?? 0;
  const totalEmpDelta = (overviewReport.kpis?.totalEmployees as any)?.delta?.percentage ?? 0;
  const attRate = (overviewReport.kpis?.attendanceRate as any)?.current ?? 0;
  const attRateDelta = (overviewReport.kpis?.attendanceRate as any)?.delta?.percentage ?? 0;
  const taskRate = (overviewReport.kpis?.taskCompletionRate as any)?.current ?? 0;
  const taskRateDelta = (overviewReport.kpis?.taskCompletionRate as any)?.delta?.percentage ?? 0;
  const eodCount = (overviewReport.kpis?.eodSubmissions as any)?.current ?? 0;
  const eodDelta = (overviewReport.kpis?.eodSubmissions as any)?.delta?.percentage ?? 0;
  const activeProj = (overviewReport.kpis?.activeProjects as any)?.current ?? 0;
  const activeProjDelta = (overviewReport.kpis?.activeProjects as any)?.delta?.percentage ?? 0;

  return {
    role: "SUPER_ADMIN",
    scope: { level: "GLOBAL", organizationCount: totalOrgs, filteredOrgId: targetOrgId || null },
    period: { start: dateRange.current.start, end: dateRange.current.end, preset: periodPreset },
    overview: overviewReport,
    kpis: [
      { label: "Total Organizations", value: totalOrgs, delta: null, unit: "tenants" },
      { label: "Global Workforce", value: totalEmp, delta: totalEmpDelta, unit: "people" },
      { label: "Platform Attendance", value: `${attRate}%`, delta: attRateDelta, unit: "" },
      { label: "Task Completion", value: `${taskRate}%`, delta: taskRateDelta, unit: "" },
      { label: "EOD Reports", value: eodCount, delta: eodDelta, unit: "reports" },
      { label: "Active Projects", value: activeProj, delta: activeProjDelta, unit: "projects" },
      ...(compensationSummary
        ? [{ label: "Monthly Payroll", value: `₹${(compensationSummary.monthlyPayrollCost || 0).toLocaleString()}`, delta: null, unit: "" }]
        : []),
    ],
    alerts,
    organizationComparison: orgSummaries,
    compensation: compensationSummary,
    notifications: notificationsData,
    quickActions,
  };
}
