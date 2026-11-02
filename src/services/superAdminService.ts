import Attendance from "../models/Attendance";
import Compensation from "../models/Compensation";
import DailyReport from "../models/DailyReport";
import Department from "../models/Department";
import Lead from "../models/Lead";
import { PointTransaction } from "../models/PointTransaction";
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

function orgFilter(organizationId?: string | null) {
  return organizationId ? { organizationId } : {};
}

export async function getSuperAdminDashboard(organizationId?: string | null) {
  const { start, end } = dayBounds();
  const org = orgFilter(organizationId);
  const activeStatuses = ["ACTIVE"];

  const [
    totalAdmins,
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
    User.countDocuments({ ...org, role: "ADMIN" }),
    User.countDocuments({ ...org, employmentType: "EMPLOYEE" }),
    User.countDocuments({ ...org, employmentType: "INTERN" }),
    User.countDocuments({ ...org, status: { $in: activeStatuses } }),
    Attendance.countDocuments({ ...org, currentStatus: "ONLINE" }),
    Attendance.countDocuments({ ...org, currentStatus: "ON_BREAK" }),
    Attendance.countDocuments({ ...org, date: { $gte: start, $lt: end }, attendanceStatus: { $in: ["PRESENT", "LATE"] } }),
    Task.countDocuments({ ...org, status: { $in: ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK"] } }),
    Task.countDocuments({ ...org, status: "COMPLETED" }),
    Task.countDocuments({ ...org, $or: [{ status: "OVERDUE" }, { dueDate: { $lt: new Date() }, status: { $nin: ["COMPLETED", "CANCELLED"] } }] }),
    Lead.countDocuments({ ...org, status: { $nin: ["CONVERTED", "LOST", "INVALID", "NOT_INTERESTED"] } }),
    Lead.countDocuments({ ...org, nextFollowUpAt: { $gte: start, $lt: end } }),
    DailyReport.countDocuments({ ...org, reportDate: { $gte: start, $lt: end }, status: { $ne: "REVIEWED" } }),
    Department.find(org).select("name code status").sort({ name: 1 }).limit(100).lean(),
    Team.find(org).select("name code status departmentId teamLeadId").sort({ name: 1 }).limit(100).lean(),
    AuditLog.find(org).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  return {
    metrics: {
      totalAdmins,
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
  };
}

export async function getReportsCenter(organizationId?: string | null) {
  const { start, end } = dayBounds();
  const org = orgFilter(organizationId);
  const [
    attendanceByStatus,
    taskByStatus,
    eodByStatus,
    performance,
    crmByStatus,
    compensationByStatus,
    pointSummary,
  ] = await Promise.all([
    Attendance.aggregate([{ $match: { ...org, date: { $gte: start, $lt: end } } }, { $group: { _id: "$attendanceStatus", count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: org }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    DailyReport.aggregate([{ $match: org }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: org }, { $group: { _id: null, completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }, total: { $sum: 1 }, actualMinutes: { $sum: "$actualMinutes" } } }]),
    Lead.aggregate([{ $match: org }, { $group: { _id: "$pipelineStage", count: { $sum: 1 } } }]),
    Compensation.aggregate([{ $match: org }, { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$baseAmount" } } }]),
    PointTransaction.aggregate([{ $match: org }, { $group: { _id: "$type", points: { $sum: "$points" }, count: { $sum: 1 } } }]),
  ]);

  return {
    attendance: attendanceByStatus,
    tasks: taskByStatus,
    eod: eodByStatus,
    performance: performance[0] || { completed: 0, total: 0, actualMinutes: 0 },
    crm: crmByStatus,
    compensation: compensationByStatus,
    points: pointSummary,
  };
}
