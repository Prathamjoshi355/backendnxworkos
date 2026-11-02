import Attendance from "../models/Attendance";
import DailyReport from "../models/DailyReport";
import Lead from "../models/Lead";
import Notification from "../models/Notification";
import { PerformanceSnapshot } from "../models/PerformanceSnapshot";
import { PointTransaction } from "../models/PointTransaction";
import { Target } from "../models/Target";
import Task from "../models/Task";
import User from "../models/User";
export { uploadOnboardingAcceptanceLetter } from "./documentService";

function dayBounds(input = new Date()) {
  const start = new Date(input);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function getEmployeeDashboard(user: any) {
  const userId = String(user._id || user.id);
  const { start, end } = dayBounds();

  const [
    attendanceToday,
    tasksAssignedToday,
    tasksCompletedToday,
    tasksPending,
    tasksOverdue,
    eodToday,
    performance,
    pointAggregate,
    activeTargets,
    recentNotifications,
  ] = await Promise.all([
    Attendance.findOne({ userId, date: { $gte: start, $lt: end } }).lean(),
    Task.countDocuments({ assignedTo: userId, createdAt: { $gte: start, $lt: end } }),
    Task.countDocuments({ assignedTo: userId, status: "COMPLETED", updatedAt: { $gte: start, $lt: end } }),
    Task.countDocuments({ assignedTo: userId, status: { $in: ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK"] } }),
    Task.countDocuments({ assignedTo: userId, $or: [{ status: "OVERDUE" }, { dueDate: { $lt: new Date() }, status: { $nin: ["COMPLETED", "CANCELLED"] } }] }),
    DailyReport.findOne({ userId, reportDate: { $gte: start, $lt: end } }).lean(),
    PerformanceSnapshot.findOne({ userId }).sort({ periodEnd: -1 }).lean(),
    PointTransaction.aggregate([{ $match: { userId } }, { $group: { _id: null, totalPoints: { $sum: "$points" } } }]),
    Target.find({ userId, status: "ACTIVE" }).select("title targetValue currentProgress periodType endDate").lean(),
    Notification.find({ userId }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  const userDoc = await User.findById(userId).select("totalPoints role employmentType designation departmentId teamId").lean();

  return {
    attendance: {
      date: attendanceToday?.date ?? new Date(),
      attendanceStatus: attendanceToday?.attendanceStatus ?? "ABSENT",
      currentStatus: attendanceToday?.currentStatus ?? "OFFLINE",
      firstLoginAt: attendanceToday?.firstLoginAt ?? null,
      lastLogoutAt: attendanceToday?.lastLogoutAt ?? null,
      totalWorkDuration: attendanceToday?.totalWorkDuration ?? 0,
      totalBreakDuration: attendanceToday?.totalBreakDuration ?? 0,
    },
    workStatus: attendanceToday?.currentStatus ?? "OFFLINE",
    taskSummary: {
      assignedToday: tasksAssignedToday,
      completedToday: tasksCompletedToday,
      pending: tasksPending,
      overdue: tasksOverdue,
    },
    eodReport: {
      status: eodToday?.status ?? "NOT_SUBMITTED",
      submittedAt: eodToday?.submittedAt ?? null,
    },
    performanceScore: (performance as any)?.performanceScore ?? (performance as any)?.finalScore ?? 85,
    points: (userDoc as any)?.totalPoints ?? (pointAggregate[0]?.totalPoints ?? 0),
    activeTargets,
    notifications: recentNotifications,
    user: {
      id: userId,
      role: userDoc?.role,
      employmentType: userDoc?.employmentType,
      designation: userDoc?.designation,
    },
  };
}

export async function getManagerDashboard(user: any) {
  const { getManagementScope } = await import("../utils/scopeHelper");
  const Team = (await import("../models/Team")).default;
  const Leave = (await import("../models/Leave")).default;
  const { start, end } = dayBounds();

  const scope = await getManagementScope(user);
  const teamIds = scope.managedTeamIds;
  const userIds = scope.scopedUserIds;

  const [
    managedTeams,
    teamLeadsCount,
    totalEmployees,
    tasksAssignedToday,
    tasksCompletedToday,
    tasksPendingReview,
    tasksOverdue,
    pendingLeavesCount,
    todayAttendance,
  ] = await Promise.all([
    Team.find({ _id: { $in: teamIds } })
      .populate("teamLeadId", "fullName email employeeId")
      .populate("managerId", "fullName email employeeId")
      .lean(),
    User.countDocuments({
      _id: { $in: userIds },
      role: "TEAM_LEADER",
    }),
    User.countDocuments({
      _id: { $in: userIds },
      role: { $nin: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
    }),
    Task.countDocuments({
      assignedTo: { $in: userIds },
      createdAt: { $gte: start, $lt: end },
    }),
    Task.countDocuments({
      assignedTo: { $in: userIds },
      status: "COMPLETED",
      updatedAt: { $gte: start, $lt: end },
    }),
    Task.countDocuments({
      assignedTo: { $in: userIds },
      status: "REVIEW",
    }),
    Task.countDocuments({
      assignedTo: { $in: userIds },
      $or: [
        { status: "OVERDUE" },
        { dueDate: { $lt: new Date() }, status: { $nin: ["COMPLETED", "CANCELLED"] } },
      ],
    }),
    Leave.countDocuments({
      userId: { $in: userIds },
      status: "PENDING",
    }),
    Attendance.find({
      userId: { $in: userIds },
      date: { $gte: start, $lt: end },
    }).lean(),
  ]);

  const presentCount = todayAttendance.filter((a) => a.attendanceStatus === "PRESENT" || a.currentStatus === "ONLINE").length;
  const onBreakCount = todayAttendance.filter((a) => a.currentStatus === "ON_BREAK").length;
  const absentCount = Math.max(0, totalEmployees - presentCount);

  return {
    managedTeamsCount: teamIds.length,
    teamLeadsCount,
    employeesCount: totalEmployees,
    managedTeams: managedTeams.map((t) => ({
      id: String(t._id),
      name: t.name,
      code: t.code,
      teamLead: t.teamLeadId,
      manager: t.managerId,
      status: t.status,
    })),
    taskSummary: {
      assignedToday: tasksAssignedToday,
      completedToday: tasksCompletedToday,
      pendingReview: tasksPendingReview,
      overdue: tasksOverdue,
    },
    teamAttendance: {
      total: totalEmployees,
      present: presentCount,
      onBreak: onBreakCount,
      absent: absentCount,
    },
    pendingLeaveRequests: pendingLeavesCount,
    teamWorkload: managedTeams.map((t) => ({
      teamId: String(t._id),
      teamName: t.name,
      teamLead: (t.teamLeadId as any)?.fullName || "Unassigned",
    })),
  };
}

export async function getTeamLeadDashboard(user: any) {
  const { getManagementScope } = await import("../utils/scopeHelper");
  const Team = (await import("../models/Team")).default;
  const Leave = (await import("../models/Leave")).default;
  const { start, end } = dayBounds();

  const scope = await getManagementScope(user);
  const teamIds = scope.managedTeamIds;
  const userIds = scope.scopedUserIds;

  // Find team details
  const team = await Team.findOne({
    $or: [
      { teamLeadId: String(user._id || user.id) },
      ...(user.teamId ? [{ _id: user.teamId }] : []),
    ],
  })
    .populate("managerId", "fullName email employeeId designation")
    .populate("teamLeadId", "fullName email employeeId designation")
    .lean();

  const teamMembers = await User.find({
    _id: { $in: userIds },
    role: { $nin: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
  })
    .select("_id employeeId fullName email role employmentType designation status workLocation workMode")
    .lean();

  const [
    tasksAssignedToday,
    tasksCompletedToday,
    tasksPendingReview,
    tasksOverdue,
    pendingLeavesCount,
    todayAttendance,
  ] = await Promise.all([
    Task.countDocuments({
      assignedTo: { $in: userIds },
      createdAt: { $gte: start, $lt: end },
    }),
    Task.countDocuments({
      assignedTo: { $in: userIds },
      status: "COMPLETED",
      updatedAt: { $gte: start, $lt: end },
    }),
    Task.countDocuments({
      assignedTo: { $in: userIds },
      status: "REVIEW",
    }),
    Task.countDocuments({
      assignedTo: { $in: userIds },
      $or: [
        { status: "OVERDUE" },
        { dueDate: { $lt: new Date() }, status: { $nin: ["COMPLETED", "CANCELLED"] } },
      ],
    }),
    Leave.countDocuments({
      userId: { $in: userIds },
      status: "PENDING",
    }),
    Attendance.find({
      userId: { $in: userIds },
      date: { $gte: start, $lt: end },
    }).lean(),
  ]);

  const memberAttendanceMap = new Map<string, any>();
  for (const a of todayAttendance) {
    memberAttendanceMap.set(String(a.userId), a);
  }

  // Workload per member
  const memberWorkload = await Promise.all(
    teamMembers.map(async (m) => {
      const mId = String(m._id);
      const pendingCount = await Task.countDocuments({
        assignedTo: mId,
        status: { $in: ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK"] },
      });
      const completedCount = await Task.countDocuments({
        assignedTo: mId,
        status: "COMPLETED",
      });
      const att = memberAttendanceMap.get(mId);

      return {
        _id: mId,
        employeeId: m.employeeId,
        fullName: m.fullName,
        email: m.email,
        designation: m.designation,
        employmentType: m.employmentType,
        pendingTasks: pendingCount,
        completedTasks: completedCount,
        attendanceStatus: att?.attendanceStatus ?? "ABSENT",
        currentStatus: att?.currentStatus ?? "OFFLINE",
      };
    })
  );

  const presentCount = todayAttendance.filter((a) => a.attendanceStatus === "PRESENT" || a.currentStatus === "ONLINE").length;
  const onBreakCount = todayAttendance.filter((a) => a.currentStatus === "ON_BREAK").length;
  const absentCount = Math.max(0, teamMembers.length - presentCount);

  return {
    team: team
      ? {
          _id: String(team._id),
          name: team.name,
          code: team.code,
          status: team.status,
          manager: team.managerId,
          teamLead: team.teamLeadId,
        }
      : null,
    totalMembers: teamMembers.length,
    members: memberWorkload,
    taskSummary: {
      assignedToday: tasksAssignedToday,
      completedToday: tasksCompletedToday,
      pendingReview: tasksPendingReview,
      overdue: tasksOverdue,
    },
    teamAttendance: {
      total: teamMembers.length,
      present: presentCount,
      onBreak: onBreakCount,
      absent: absentCount,
    },
    pendingLeaveRequests: pendingLeavesCount,
  };
}

