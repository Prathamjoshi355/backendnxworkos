import Attendance from "../models/Attendance";
import DailyReport from "../models/DailyReport";
import Department from "../models/Department";
import Lead from "../models/Lead";
import Task from "../models/Task";
import Team from "../models/Team";
import User from "../models/User";
import AuditLog from "../models/AuditLog";

function dayBounds(input = new Date()) {
  const start = new Date(input);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function getAdminDashboard(authUser: any) {
  const { start, end } = dayBounds();
  const orgId = authUser.organizationId ? String(authUser.organizationId) : null;
  const deptId = authUser.departmentId ? String(authUser.departmentId) : null;
  const teamId = authUser.teamId ? String(authUser.teamId) : null;
  const scope = authUser.accessScope || (deptId ? "DEPARTMENT" : "ORGANIZATION");

  const userQuery: Record<string, unknown> = { role: { $ne: "SUPER_ADMIN" } };
  if (orgId) userQuery.organizationId = orgId;
  if (scope === "DEPARTMENT" && deptId) userQuery.departmentId = deptId;
  if (scope === "TEAM" && teamId) userQuery.teamId = teamId;

  const scopedUsers = await User.find(userQuery).select("_id fullName role employmentType departmentId teamId").lean();
  const scopedUserIds = scopedUsers.map((u) => u._id);

  const orgFilter = orgId ? { organizationId: orgId } : {};

  const [
    totalEmployees,
    totalInterns,
    activeUsers,
    onlineUsers,
    onBreak,
    todayAttendance,
    pendingTasks,
    completedTasks,
    overdueTasks,
    openLeads,
    todaysFollowUps,
    pendingEodReports,
    departments,
    teams,
    recentActivity,
  ] = await Promise.all([
    User.countDocuments({ ...userQuery, employmentType: "EMPLOYEE" }),
    User.countDocuments({ ...userQuery, employmentType: "INTERN" }),
    User.countDocuments({ ...userQuery, status: "ACTIVE" }),
    Attendance.countDocuments({ userId: { $in: scopedUserIds }, currentStatus: "ONLINE" }),
    Attendance.countDocuments({ userId: { $in: scopedUserIds }, currentStatus: "ON_BREAK" }),
    Attendance.countDocuments({ date: { $gte: start, $lt: end }, userId: { $in: scopedUserIds }, attendanceStatus: { $in: ["PRESENT", "LATE"] } }),
    Task.countDocuments({ assignedTo: { $in: scopedUserIds }, status: { $in: ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK"] } }),
    Task.countDocuments({ assignedTo: { $in: scopedUserIds }, status: "COMPLETED" }),
    Task.countDocuments({ assignedTo: { $in: scopedUserIds }, $or: [{ status: "OVERDUE" }, { dueDate: { $lt: new Date() }, status: { $nin: ["COMPLETED", "CANCELLED"] } }] }),
    Lead.countDocuments({ ...orgFilter, assignedTo: { $in: scopedUserIds }, status: { $nin: ["CONVERTED", "LOST", "INVALID", "NOT_INTERESTED"] } }),
    Lead.countDocuments({ ...orgFilter, assignedTo: { $in: scopedUserIds }, nextFollowUpAt: { $gte: start, $lt: end } }),
    DailyReport.countDocuments({ userId: { $in: scopedUserIds }, reportDate: { $gte: start, $lt: end }, status: { $ne: "REVIEWED" } }),
    Department.find(deptId ? { _id: deptId } : orgFilter).select("name code status").sort({ name: 1 }).limit(50).lean(),
    Team.find(teamId ? { _id: teamId } : (deptId ? { departmentId: deptId } : orgFilter)).select("name code status departmentId teamLeadId").sort({ name: 1 }).limit(50).lean(),
    AuditLog.find({ ...orgFilter, actorId: { $in: scopedUserIds } }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  return {
    metrics: {
      totalEmployees,
      totalInterns,
      activeUsers,
      onlineUsers,
      onBreak,
      todayAttendance,
      pendingTasks,
      completedTasks,
      overdueTasks,
      openLeads,
      todaysFollowUps,
      pendingEodReports,
    },
    departmentSummary: departments,
    teamSummary: teams,
    recentActivity,
    scope: {
      level: scope,
      organizationId: orgId,
      departmentId: deptId,
      teamId: teamId,
    },
  };
}

export async function getAdminReports(authUser: any) {
  const { start, end } = dayBounds();
  const orgId = authUser.organizationId ? String(authUser.organizationId) : null;
  const deptId = authUser.departmentId ? String(authUser.departmentId) : null;
  const teamId = authUser.teamId ? String(authUser.teamId) : null;
  const scope = authUser.accessScope || (deptId ? "DEPARTMENT" : "ORGANIZATION");

  const userQuery: Record<string, unknown> = { role: { $ne: "SUPER_ADMIN" } };
  if (orgId) userQuery.organizationId = orgId;
  if (scope === "DEPARTMENT" && deptId) userQuery.departmentId = deptId;
  if (scope === "TEAM" && teamId) userQuery.teamId = teamId;

  const scopedUsers = await User.find(userQuery).select("_id").lean();
  const scopedUserIds = scopedUsers.map((u) => u._id);

  const [
    attendanceByStatus,
    taskByStatus,
    eodByStatus,
    performance,
    crmByStatus,
    pointSummary,
  ] = await Promise.all([
    Attendance.aggregate([{ $match: { userId: { $in: scopedUserIds }, date: { $gte: start, $lt: end } } }, { $group: { _id: "$attendanceStatus", count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: { assignedTo: { $in: scopedUserIds } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    DailyReport.aggregate([{ $match: { userId: { $in: scopedUserIds } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: { assignedTo: { $in: scopedUserIds } } }, { $group: { _id: null, completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }, total: { $sum: 1 }, actualMinutes: { $sum: "$actualMinutes" } } }]),
    Lead.aggregate([{ $match: { assignedTo: { $in: scopedUserIds } } }, { $group: { _id: "$pipelineStage", count: { $sum: 1 } } }]),
    AuditLog.aggregate([{ $match: { actorId: { $in: scopedUserIds } } }, { $group: { _id: "$action", count: { $sum: 1 } } }]),
  ]);

  return {
    attendance: attendanceByStatus,
    tasks: taskByStatus,
    eod: eodByStatus,
    performance: performance[0] || { completed: 0, total: 0, actualMinutes: 0 },
    crm: crmByStatus,
    points: pointSummary,
    scope: { level: scope, departmentId: deptId, teamId: teamId },
  };
}
