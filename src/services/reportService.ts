import mongoose from "mongoose";
import Attendance from "../models/Attendance";
import Compensation from "../models/Compensation";
import DailyReport from "../models/DailyReport";
import Department from "../models/Department";
import Lead from "../models/Lead";
import Leave from "../models/Leave";
import Meeting from "../models/Meeting";
import { PerformanceSnapshot } from "../models/PerformanceSnapshot";
import { PointTransaction } from "../models/PointTransaction";
import Project from "../models/Project";
import Task from "../models/Task";
import Team from "../models/Team";
import User from "../models/User";
import { parseReportDateRange, calculateDelta } from "../utils/dateRangeHelper";
import { serializeToCsv, CsvColumn } from "../utils/csvExport";

const PRIVILEGED_ROLES = ["SUPER_ADMIN", "ADMIN", "HR"];

/**
 * Builds base query filters respecting organization isolation and role scope.
 */
function resolveScopeFilter(authUser: any, targetOrgId?: string | null) {
  const isSuperAdmin = authUser.role === "SUPER_ADMIN";
  const rawOrg = isSuperAdmin && targetOrgId ? targetOrgId : authUser.organizationId;
  const orgIdStr = rawOrg ? String(rawOrg) : "";
  const orgIdObj = orgIdStr && mongoose.isValidObjectId(orgIdStr) ? new mongoose.Types.ObjectId(orgIdStr) : null;

  const rawUser = authUser._id || authUser.id;
  const userIdStr = rawUser ? String(rawUser) : "";
  const userIdObj = userIdStr && mongoose.isValidObjectId(userIdStr) ? new mongoose.Types.ObjectId(userIdStr) : null;

  const isEmployee = ["EMPLOYEE", "INTERN", "DESIGNER", "SALES_EXECUTIVE"].includes(authUser.role);
  const isManager = authUser.role === "MANAGER" || authUser.role === "TEAM_LEADER";

  const baseOrgFilter: Record<string, unknown> = {};
  if (orgIdObj) {
    baseOrgFilter.organizationId = orgIdObj;
  } else if (orgIdStr) {
    baseOrgFilter.organizationId = orgIdStr;
  }

  return {
    isSuperAdmin,
    isEmployee,
    isManager,
    orgId: orgIdStr,
    userId: userIdObj || userIdStr,
    userIdStr,
    baseOrgFilter,
  };
}

/**
 * 1. Executive Organization Overview Report
 */
export async function getOverviewReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, orgId, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current, previous } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  // If regular employee, provide personal summary overview
  if (isEmployee) {
    const [tasksCurr, tasksPrev, attCurr, attPrev, eodCurr, eodPrev] = await Promise.all([
      Task.countDocuments({ ...baseOrgFilter, assignedTo: userId, createdAt: { $gte: current.start, $lte: current.end } }),
      Task.countDocuments({ ...baseOrgFilter, assignedTo: userId, createdAt: { $gte: previous.start, $lte: previous.end } }),
      Attendance.countDocuments({ ...baseOrgFilter, userId, date: { $gte: current.start, $lte: current.end }, attendanceStatus: "PRESENT" }),
      Attendance.countDocuments({ ...baseOrgFilter, userId, date: { $gte: previous.start, $lte: previous.end }, attendanceStatus: "PRESENT" }),
      DailyReport.countDocuments({ ...baseOrgFilter, userId, reportDate: { $gte: current.start, $lte: current.end } }),
      DailyReport.countDocuments({ ...baseOrgFilter, userId, reportDate: { $gte: previous.start, $lte: previous.end } }),
    ]);

    return {
      category: "overview",
      scope: "PERSONAL",
      period: current,
      kpis: {
        totalTasks: { current: tasksCurr, previous: tasksPrev, delta: calculateDelta(tasksCurr, tasksPrev) },
        presentDays: { current: attCurr, previous: attPrev, delta: calculateDelta(attCurr, attPrev) },
        eodSubmitted: { current: eodCurr, previous: eodPrev, delta: calculateDelta(eodCurr, eodPrev) },
      },
    };
  }

  // Organization-level aggregates for Admin / Super Admin / HR
  const [
    totalEmployeesCurr,
    totalEmployeesPrev,
    activeEmployees,
    attRecordsCurr,
    attRecordsPrev,
    tasksCurr,
    tasksPrev,
    eodCurr,
    eodPrev,
    activeProjects,
    totalMeetings,
    departments,
  ] = await Promise.all([
    User.countDocuments({ ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" } }),
    User.countDocuments({ ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" }, createdAt: { $lte: previous.end } }),
    User.countDocuments({ ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" }, status: "ACTIVE" }),
    Attendance.aggregate([
      { $match: { ...baseOrgFilter, date: { $gte: current.start, $lte: current.end } } },
      { $group: { _id: null, total: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ["$attendanceStatus", ["PRESENT", "LATE", "HALF_DAY"]] }, 1, 0] } } } },
    ]),
    Attendance.aggregate([
      { $match: { ...baseOrgFilter, date: { $gte: previous.start, $lte: previous.end } } },
      { $group: { _id: null, total: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ["$attendanceStatus", ["PRESENT", "LATE", "HALF_DAY"]] }, 1, 0] } } } },
    ]),
    Task.aggregate([
      { $match: { ...baseOrgFilter, createdAt: { $gte: current.start, $lte: current.end } } },
      { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } } } },
    ]),
    Task.aggregate([
      { $match: { ...baseOrgFilter, createdAt: { $gte: previous.start, $lte: previous.end } } },
      { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } } } },
    ]),
    DailyReport.countDocuments({ ...baseOrgFilter, reportDate: { $gte: current.start, $lte: current.end } }),
    DailyReport.countDocuments({ ...baseOrgFilter, reportDate: { $gte: previous.start, $lte: previous.end } }),
    Project.countDocuments({ ...baseOrgFilter, status: "ACTIVE" }),
    Meeting.countDocuments({ ...baseOrgFilter, date: { $gte: current.start, $lte: current.end } }),
    Department.find(baseOrgFilter).select("_id name code").lean(),
  ]);

  const attTotalCurr = attRecordsCurr[0]?.total || 0;
  const attPresCurr = attRecordsCurr[0]?.present || 0;
  const attRateCurr = attTotalCurr > 0 ? Math.round((attPresCurr / attTotalCurr) * 100 * 10) / 10 : 0;

  const attTotalPrev = attRecordsPrev[0]?.total || 0;
  const attPresPrev = attRecordsPrev[0]?.present || 0;
  const attRatePrev = attTotalPrev > 0 ? Math.round((attPresPrev / attTotalPrev) * 100 * 10) / 10 : 0;

  const taskTotalCurr = tasksCurr[0]?.total || 0;
  const taskCompCurr = tasksCurr[0]?.completed || 0;
  const taskRateCurr = taskTotalCurr > 0 ? Math.round((taskCompCurr / taskTotalCurr) * 100 * 10) / 10 : 0;

  const taskTotalPrev = tasksPrev[0]?.total || 0;
  const taskCompPrev = tasksPrev[0]?.completed || 0;
  const taskRatePrev = taskTotalPrev > 0 ? Math.round((taskCompPrev / taskTotalPrev) * 100 * 10) / 10 : 0;

  // Department distribution
  const deptEmployeeCounts = await User.aggregate([
    { $match: { ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" }, departmentId: { $ne: null } } },
    { $group: { _id: "$departmentId", count: { $sum: 1 } } },
  ]);

  const deptMap = new Map<string, string>();
  departments.forEach((d) => deptMap.set(String(d._id), d.name));

  const departmentBreakdown = deptEmployeeCounts.map((d) => ({
    departmentId: String(d._id),
    name: deptMap.get(String(d._id)) || "Unknown",
    employeeCount: d.count,
  }));

  return {
    category: "overview",
    scope: "ORGANIZATION",
    period: current,
    kpis: {
      totalEmployees: { current: totalEmployeesCurr, previous: totalEmployeesPrev, delta: calculateDelta(totalEmployeesCurr, totalEmployeesPrev) },
      activeEmployees: { current: activeEmployees, previous: activeEmployees, delta: calculateDelta(activeEmployees, activeEmployees) },
      attendanceRate: { current: attRateCurr, previous: attRatePrev, delta: calculateDelta(attRateCurr, attRatePrev) },
      taskCompletionRate: { current: taskRateCurr, previous: taskRatePrev, delta: calculateDelta(taskRateCurr, taskRatePrev) },
      eodSubmissions: { current: eodCurr, previous: eodPrev, delta: calculateDelta(eodCurr, eodPrev) },
      activeProjects: { current: activeProjects, previous: activeProjects, delta: calculateDelta(activeProjects, activeProjects) },
      meetingsHeld: { current: totalMeetings, previous: 0, delta: calculateDelta(totalMeetings, 0) },
    },
    departmentBreakdown,
  };
}

/**
 * 2. Employee Productivity & 360° Report
 */
export async function getEmployeesReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, isManager, orgId, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const userQuery: Record<string, unknown> = { ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" } };

  if (isEmployee) {
    userQuery._id = userId;
  } else if (isManager) {
    userQuery.$or = [{ _id: userId }, { reportingManagerId: userId }];
  }

  if (queryParams.departmentId) {
    userQuery.departmentId = queryParams.departmentId;
  }
  if (queryParams.status) {
    userQuery.status = queryParams.status;
  }
  if (queryParams.search) {
    const s = queryParams.search.trim();
    userQuery.$or = [{ fullName: { $regex: s, $options: "i" } }, { email: { $regex: s, $options: "i" } }, { employeeId: { $regex: s, $options: "i" } }];
  }

  const page = Math.max(1, parseInt(queryParams.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(queryParams.limit || "20", 10)));
  const skip = (page - 1) * limit;

  const [total, users] = await Promise.all([
    User.countDocuments(userQuery),
    User.find(userQuery)
      .select("_id fullName email employeeId designation departmentId teamId status role joiningDate")
      .populate("departmentId", "name")
      .populate("teamId", "name")
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const targetUserIds = users.map((u) => u._id);

  // Aggregate attendance, tasks, EOD, points for these users in the current period
  const [attStats, taskStats, eodStats, pointsStats] = await Promise.all([
    Attendance.aggregate([
      { $match: { ...baseOrgFilter, userId: { $in: targetUserIds }, date: { $gte: current.start, $lte: current.end } } },
      {
        $group: {
          _id: "$userId",
          totalDays: { $sum: 1 },
          presentDays: { $sum: { $cond: [{ $eq: ["$attendanceStatus", "PRESENT"] }, 1, 0] } },
          lateDays: { $sum: { $cond: [{ $gt: ["$lateArrivalMinutes", 0] }, 1, 0] } },
        },
      },
    ]),
    Task.aggregate([
      { $match: { ...baseOrgFilter, assignedTo: { $in: targetUserIds }, createdAt: { $gte: current.start, $lte: current.end } } },
      {
        $group: {
          _id: "$assignedTo",
          assigned: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $eq: ["$status", "OVERDUE"] }, 1, 0] } },
        },
      },
    ]),
    DailyReport.aggregate([
      { $match: { ...baseOrgFilter, userId: { $in: targetUserIds }, reportDate: { $gte: current.start, $lte: current.end } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]),
    PointTransaction.aggregate([
      { $match: { ...baseOrgFilter, userId: { $in: targetUserIds }, createdAt: { $gte: current.start, $lte: current.end } } },
      { $group: { _id: "$userId", totalPoints: { $sum: "$points" } } },
    ]),
  ]);

  const attMap = new Map(attStats.map((a) => [String(a._id), a]));
  const taskMap = new Map(taskStats.map((t) => [String(t._id), t]));
  const eodMap = new Map(eodStats.map((e) => [String(e._id), e.count]));
  const pointsMap = new Map(pointsStats.map((p) => [String(p._id), p.totalPoints]));

  const items = users.map((u) => {
    const uId = String(u._id);
    const a = attMap.get(uId) || { totalDays: 0, presentDays: 0, lateDays: 0 };
    const t = taskMap.get(uId) || { assigned: 0, completed: 0, overdue: 0 };
    const e = eodMap.get(uId) || 0;
    const p = pointsMap.get(uId) || 0;

    const attendanceRate = a.totalDays > 0 ? Math.round((a.presentDays / a.totalDays) * 100) : 0;
    const taskCompletionRate = t.assigned > 0 ? Math.round((t.completed / t.assigned) * 100) : 0;

    return {
      userId: uId,
      employeeId: u.employeeId || "",
      fullName: u.fullName || "",
      email: u.email || "",
      designation: u.designation || "",
      departmentName: (u.departmentId as any)?.name || "Unassigned",
      teamName: (u.teamId as any)?.name || "Unassigned",
      status: u.status,
      role: u.role,
      attendance: {
        totalDays: a.totalDays,
        presentDays: a.presentDays,
        lateDays: a.lateDays,
        attendanceRate,
      },
      tasks: {
        assigned: t.assigned,
        completed: t.completed,
        overdue: t.overdue,
        completionRate: taskCompletionRate,
      },
      eodSubmissions: e,
      pointsEarned: p,
    };
  });

  return {
    category: "employees",
    period: current,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    items,
  };
}

/**
 * 3. Attendance Deep-Dive Report
 */
export async function getAttendanceReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, isManager, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const match: Record<string, unknown> = {
    ...baseOrgFilter,
    date: { $gte: current.start, $lte: current.end },
  };

  if (isEmployee) {
    match.userId = userId;
  } else if (isManager && queryParams.teamId) {
    match.teamId = queryParams.teamId;
  }

  if (queryParams.userId && !isEmployee) {
    match.userId = queryParams.userId;
  }
  if (queryParams.status) {
    match.attendanceStatus = queryParams.status;
  }

  const [summaryAgg, items] = await Promise.all([
    Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $in: ["$attendanceStatus", ["PRESENT", "LATE", "HALF_DAY"]] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ["$attendanceStatus", "ABSENT"] }, 1, 0] } },
          late: { $sum: { $cond: [{ $or: [{ $eq: ["$attendanceStatus", "LATE"] }, { $gt: ["$lateArrivalMinutes", 0] }] }, 1, 0] } },
          halfDay: { $sum: { $cond: [{ $eq: ["$attendanceStatus", "HALF_DAY"] }, 1, 0] } },
          totalWorkMinutes: { $sum: { $ifNull: ["$totalWorkDuration", "$totalWorkMinutes"] } },
          totalBreakMinutes: { $sum: { $ifNull: ["$totalBreakDuration", "$totalBreakMinutes"] } },
        },
      },
    ]),
    Attendance.find(match)
      .sort({ date: -1 })
      .limit(100)
      .populate("userId", "fullName employeeId email designation")
      .lean(),
  ]);

  const summary = summaryAgg[0] || {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
    halfDay: 0,
    totalWorkMinutes: 0,
    totalBreakMinutes: 0,
  };

  const attendanceRate = summary.total > 0 ? Math.round((summary.present / summary.total) * 100 * 10) / 10 : 0;
  const avgWorkMinutes = summary.present > 0 ? Math.round(summary.totalWorkMinutes / summary.present) : 0;
  const avgBreakMinutes = summary.present > 0 ? Math.round(summary.totalBreakMinutes / summary.present) : 0;

  return {
    category: "attendance",
    period: current,
    summary: {
      totalRecords: summary.total,
      presentCount: summary.present,
      absentCount: summary.absent,
      lateCount: summary.late,
      halfDayCount: summary.halfDay,
      attendanceRate,
      totalWorkHours: Math.round((summary.totalWorkMinutes / 60) * 10) / 10,
      avgWorkHoursPerDay: Math.round((avgWorkMinutes / 60) * 10) / 10,
      avgBreakMinutesPerDay: avgBreakMinutes,
    },
    items,
  };
}

/**
 * 4. Task & Productivity Report
 */
export async function getTasksReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, isManager, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const match: Record<string, unknown> = {
    ...baseOrgFilter,
    createdAt: { $gte: current.start, $lte: current.end },
  };

  if (isEmployee) {
    match.assignedTo = userId;
  } else if (queryParams.assignedTo) {
    match.assignedTo = queryParams.assignedTo;
  }
  if (queryParams.status) {
    match.status = queryParams.status;
  }
  if (queryParams.priority) {
    match.priority = queryParams.priority;
  }

  const [statusAgg, priorityAgg, items] = await Promise.all([
    Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $eq: ["$status", "OVERDUE"] }, 1, 0] } },
          approved: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$status", "COMPLETED"] },
                    { $eq: ["$approvalStatus", "APPROVED"] },
                    { $ne: [{ $ifNull: ["$approvedAt", null] }, null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          rejected: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$status", "REWORK"] },
                    { $eq: ["$approvalStatus", "REJECTED"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalMinutes: { $sum: "$actualMinutes" },
        },
      },
    ]),
    Task.aggregate([{ $match: match }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
    Task.find(match)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("assignedTo", "fullName employeeId")
      .populate("projectId", "name")
      .lean(),
  ]);

  const s = statusAgg[0] || {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    overdue: 0,
    approved: 0,
    rejected: 0,
    totalMinutes: 0,
  };

  const completionRate = s.total > 0 ? Math.round((s.completed / s.total) * 100 * 10) / 10 : 0;
  const reviewTotal = s.approved + s.rejected;
  const approvalRate = reviewTotal > 0 ? Math.round((s.approved / reviewTotal) * 100 * 10) / 10 : 0;

  const priorityBreakdown: Record<string, number> = {};
  priorityAgg.forEach((p) => {
    if (p._id) priorityBreakdown[p._id] = p.count;
  });

  return {
    category: "tasks",
    period: current,
    summary: {
      total: s.total,
      completed: s.completed,
      inProgress: s.inProgress,
      pending: s.pending,
      overdue: s.overdue,
      approved: s.approved,
      rejected: s.rejected,
      completionRate,
      approvalRate,
      totalHoursWorked: Math.round((s.totalMinutes / 60) * 10) / 10,
    },
    priorityBreakdown,
    items,
  };
}

/**
 * 5. EOD Compliance Report
 */
export async function getEodReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const match: Record<string, unknown> = {
    ...baseOrgFilter,
    reportDate: { $gte: current.start, $lte: current.end },
  };

  if (isEmployee) {
    match.userId = userId;
  } else if (queryParams.userId) {
    match.userId = queryParams.userId;
  }

  const [summaryAgg, items] = await Promise.all([
    DailyReport.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          submitted: { $sum: { $cond: [{ $ne: ["$status", "DRAFT"] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } },
          rework: { $sum: { $cond: [{ $eq: ["$status", "REWORK"] }, 1, 0] } },
          totalHours: {
            $sum: {
              $cond: [
                { $gt: ["$totalWorkedMinutes", 0] },
                { $divide: ["$totalWorkedMinutes", 60] },
                { $ifNull: ["$totalHoursWorked", 0] },
              ],
            },
          },
        },
      },
    ]),
    DailyReport.find(match)
      .sort({ reportDate: -1 })
      .limit(100)
      .populate("userId", "fullName employeeId")
      .lean(),
  ]);

  const s = summaryAgg[0] || { total: 0, submitted: 0, approved: 0, rework: 0, totalHours: 0 };
  const approvalRate = s.submitted > 0 ? Math.round((s.approved / s.submitted) * 100 * 10) / 10 : 0;

  return {
    category: "eod",
    period: current,
    summary: {
      totalReports: s.total,
      submittedCount: s.submitted,
      approvedCount: s.approved,
      reworkCount: s.rework,
      approvalRate,
      totalHoursReported: Math.round(s.totalHours * 10) / 10,
    },
    items,
  };
}

/**
 * 6. Leave Utilization Report
 */
export async function getLeaveReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const match: Record<string, unknown> = {
    ...baseOrgFilter,
    startDate: { $gte: current.start, $lte: current.end },
  };

  if (isEmployee) {
    match.userId = userId;
  } else if (queryParams.userId) {
    match.userId = queryParams.userId;
  }

  const [summaryAgg, typeAgg, items] = await Promise.all([
    Leave.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "REJECTED"] }, 1, 0] } },
          totalDays: { $sum: "$totalDays" },
        },
      },
    ]),
    Leave.aggregate([{ $match: match }, { $group: { _id: "$leaveTypeName", count: { $sum: 1 }, days: { $sum: "$totalDays" } } }]),
    Leave.find(match)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("userId", "fullName employeeId departmentId")
      .lean(),
  ]);

  const s = summaryAgg[0] || { total: 0, approved: 0, pending: 0, rejected: 0, totalDays: 0 };
  const approvalRate = s.total > 0 ? Math.round((s.approved / s.total) * 100 * 10) / 10 : 0;

  const byType: Record<string, { count: number; days: number }> = {};
  typeAgg.forEach((t) => {
    if (t._id) byType[t._id] = { count: t.count, days: t.days };
  });

  return {
    category: "leave",
    period: current,
    summary: {
      totalRequests: s.total,
      approvedCount: s.approved,
      pendingCount: s.pending,
      rejectedCount: s.rejected,
      totalDays: s.totalDays,
      approvalRate,
    },
    byType,
    items,
  };
}

/**
 * 7. Performance & Points Report
 */
export async function getPerformanceReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const match: Record<string, unknown> = {
    ...baseOrgFilter,
    createdAt: { $gte: current.start, $lte: current.end },
  };

  if (isEmployee) {
    match.userId = userId;
  }

  const [pointsAgg, snapshots] = await Promise.all([
    PointTransaction.aggregate([
      { $match: match },
      { $group: { _id: "$type", totalPoints: { $sum: "$points" }, count: { $sum: 1 } } },
    ]),
    PerformanceSnapshot.find({ ...baseOrgFilter, periodEnd: { $gte: current.start, $lte: current.end } })
      .sort({ periodEnd: -1 })
      .limit(100)
      .populate("userId", "fullName employeeId designation departmentId")
      .lean(),
  ]);

  let totalPointsDistributed = 0;
  const pointsByType: Record<string, number> = {};
  pointsAgg.forEach((p) => {
    if (p._id) pointsByType[p._id] = p.totalPoints;
    totalPointsDistributed += p.totalPoints;
  });

  const scores = snapshots.map((s: any) => s.performanceScore || s.finalScore || 0);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 85;

  return {
    category: "performance",
    period: current,
    summary: {
      averageScore: avgScore,
      snapshotsCount: snapshots.length,
      totalPointsDistributed,
    },
    pointsByType,
    snapshots,
  };
}

/**
 * 8. Project Progress Report
 */
export async function getProjectsReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const match: Record<string, unknown> = { ...baseOrgFilter };
  if (isEmployee) {
    match.members = userId;
  }
  if (queryParams.status) {
    match.status = queryParams.status;
  }

  const [statusAgg, items] = await Promise.all([
    Project.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 }, avgProgress: { $avg: "$progress" } } }]),
    Project.find(match).sort({ updatedAt: -1 }).limit(50).populate("departmentId", "name").lean(),
  ]);

  let total = 0;
  let active = 0;
  let completed = 0;
  const byStatus: Record<string, number> = {};

  statusAgg.forEach((s) => {
    total += s.count;
    if (s._id === "ACTIVE") active = s.count;
    if (s._id === "COMPLETED") completed = s.count;
    if (s._id) byStatus[s._id] = s.count;
  });

  return {
    category: "projects",
    period: current,
    summary: {
      totalProjects: total,
      activeProjects: active,
      completedProjects: completed,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    byStatus,
    items,
  };
}

/**
 * 9. Meetings & Collaboration Report
 */
export async function getMeetingsReport(authUser: any, queryParams: Record<string, string>) {
  const { isEmployee, userId, baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const match: Record<string, unknown> = {
    ...baseOrgFilter,
    date: { $gte: current.start, $lte: current.end },
  };

  if (isEmployee) {
    match.$or = [{ organizerId: userId }, { "participants.userId": userId }];
  }

  const [statusAgg, items] = await Promise.all([
    Meeting.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Meeting.find(match).sort({ date: -1 }).limit(100).populate("organizerId", "fullName employeeId").lean(),
  ]);

  let total = 0;
  let completed = 0;
  let upcoming = 0;
  let cancelled = 0;

  statusAgg.forEach((s) => {
    total += s.count;
    if (s._id === "COMPLETED") completed = s.count;
    if (s._id === "SCHEDULED") upcoming = s.count;
    if (s._id === "CANCELLED") cancelled = s.count;
  });

  return {
    category: "meetings",
    period: current,
    summary: {
      totalMeetings: total,
      completedMeetings: completed,
      upcomingMeetings: upcoming,
      cancelledMeetings: cancelled,
    },
    items,
  };
}

/**
 * 10. HR Workforce Lifecycle Report
 */
export async function getHrReport(authUser: any, queryParams: Record<string, string>) {
  const { baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const [totalHeadcount, statusAgg, typeAgg, depts] = await Promise.all([
    User.countDocuments({ ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" } }),
    User.aggregate([
      { $match: { ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" } } },
      { $group: { _id: "$employmentStatus", count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $match: { ...baseOrgFilter, role: { $ne: "SUPER_ADMIN" } } },
      { $group: { _id: "$employmentType", count: { $sum: 1 } } },
    ]),
    Department.find(baseOrgFilter).select("_id name").lean(),
  ]);

  const lifecycleBreakdown: Record<string, number> = {};
  statusAgg.forEach((s) => {
    if (s._id) lifecycleBreakdown[s._id] = s.count;
  });

  const employmentTypes: Record<string, number> = {};
  typeAgg.forEach((t) => {
    if (t._id) employmentTypes[t._id] = t.count;
  });

  return {
    category: "hr",
    period: current,
    summary: {
      totalHeadcount,
      activeCount: lifecycleBreakdown["ACTIVE"] || 0,
      probationCount: lifecycleBreakdown["PROBATION"] || 0,
      confirmedCount: lifecycleBreakdown["CONFIRMED"] || 0,
      noticePeriodCount: lifecycleBreakdown["NOTICE_PERIOD"] || 0,
      exitedCount: lifecycleBreakdown["EXITED"] || 0,
    },
    lifecycleBreakdown,
    employmentTypes,
  };
}

/**
 * 11. Compensation & Payroll Cost Report (STRICTLY Role-Gated to Admin / Super Admin / HR)
 */
export async function getCompensationReport(authUser: any, queryParams: Record<string, string>) {
  if (!PRIVILEGED_ROLES.includes(authUser.role)) {
    throw new Error("FORBIDDEN_COMPENSATION_REPORT");
  }

  const { baseOrgFilter } = resolveScopeFilter(authUser, queryParams.organizationId);
  const { current } = parseReportDateRange(queryParams.dateRange, queryParams.startDate, queryParams.endDate);

  const [statusAgg, typeAgg, totalAmountAgg] = await Promise.all([
    Compensation.aggregate([
      { $match: baseOrgFilter },
      { $group: { _id: "$status", count: { $sum: 1 }, totalBase: { $sum: "$baseAmount" } } },
    ]),
    Compensation.aggregate([
      { $match: { ...baseOrgFilter, status: "ACTIVE" } },
      { $group: { _id: "$compensationType", count: { $sum: 1 }, totalBase: { $sum: "$baseAmount" } } },
    ]),
    Compensation.aggregate([
      { $match: { ...baseOrgFilter, status: "ACTIVE" } },
      { $group: { _id: null, totalMonthlyCost: { $sum: "$baseAmount" }, count: { $sum: 1 }, avgSalary: { $avg: "$baseAmount" } } },
    ]),
  ]);

  const total = totalAmountAgg[0] || { totalMonthlyCost: 0, count: 0, avgSalary: 0 };

  return {
    category: "compensation",
    period: current,
    summary: {
      totalActiveCompensations: total.count,
      totalMonthlyPayroll: Math.round(total.totalMonthlyCost),
      averageSalary: Math.round(total.avgSalary),
    },
    byStatus: statusAgg,
    byType: typeAgg,
  };
}

/**
 * Universal category dispatcher
 */
export async function getCategoryReport(category: string, authUser: any, queryParams: Record<string, string>) {
  const cat = (category || "").toLowerCase().trim();

  switch (cat) {
    case "overview":
      return getOverviewReport(authUser, queryParams);
    case "employees":
      return getEmployeesReport(authUser, queryParams);
    case "attendance":
      return getAttendanceReport(authUser, queryParams);
    case "tasks":
      return getTasksReport(authUser, queryParams);
    case "eod":
      return getEodReport(authUser, queryParams);
    case "leave":
    case "leaves":
      return getLeaveReport(authUser, queryParams);
    case "performance":
      return getPerformanceReport(authUser, queryParams);
    case "projects":
      return getProjectsReport(authUser, queryParams);
    case "meetings":
      return getMeetingsReport(authUser, queryParams);
    case "hr":
      return getHrReport(authUser, queryParams);
    case "compensation":
      return getCompensationReport(authUser, queryParams);
    default:
      throw new Error(`INVALID_REPORT_CATEGORY: ${category}`);
  }
}

/**
 * CSV Export Engine for all categories
 */
export async function exportReportCsv(category: string, authUser: any, queryParams: Record<string, string>): Promise<{ filename: string; csv: string }> {
  const cat = (category || "").toLowerCase().trim();
  const timestamp = new Date().toISOString().slice(0, 10);

  switch (cat) {
    case "employees": {
      const data = await getEmployeesReport(authUser, { ...queryParams, limit: "1000" });
      const columns: CsvColumn[] = [
        { header: "Employee ID", accessor: "employeeId" },
        { header: "Full Name", accessor: "fullName" },
        { header: "Email", accessor: "email" },
        { header: "Designation", accessor: "designation" },
        { header: "Department", accessor: "departmentName" },
        { header: "Team", accessor: "teamName" },
        { header: "Status", accessor: "status" },
        { header: "Attendance Rate (%)", accessor: (r) => r.attendance.attendanceRate },
        { header: "Tasks Completed", accessor: (r) => r.tasks.completed },
        { header: "Task Completion Rate (%)", accessor: (r) => r.tasks.completionRate },
        { header: "EOD Submissions", accessor: "eodSubmissions" },
        { header: "Points Earned", accessor: "pointsEarned" },
      ];
      return {
        filename: `employees_report_${timestamp}.csv`,
        csv: serializeToCsv(data.items, columns),
      };
    }

    case "attendance": {
      const data = await getAttendanceReport(authUser, queryParams);
      const columns: CsvColumn[] = [
        { header: "Date", accessor: (r) => (r.date ? new Date(r.date).toISOString().slice(0, 10) : "") },
        { header: "Employee", accessor: (r) => (r.userId as any)?.fullName || "" },
        { header: "Employee ID", accessor: (r) => (r.userId as any)?.employeeId || "" },
        { header: "Status", accessor: "attendanceStatus" },
        { header: "Login At", accessor: (r) => (r.loginAt ? new Date(r.loginAt).toLocaleTimeString() : "") },
        { header: "Logout At", accessor: (r) => (r.logoutAt ? new Date(r.logoutAt).toLocaleTimeString() : "") },
        { header: "Work Minutes", accessor: "totalWorkMinutes" },
        { header: "Break Minutes", accessor: "totalBreakMinutes" },
        { header: "Late Arrival (mins)", accessor: "lateArrivalMinutes" },
      ];
      return {
        filename: `attendance_report_${timestamp}.csv`,
        csv: serializeToCsv(data.items, columns),
      };
    }

    case "tasks": {
      const data = await getTasksReport(authUser, queryParams);
      const columns: CsvColumn[] = [
        { header: "Task Title", accessor: "title" },
        { header: "Status", accessor: "status" },
        { header: "Priority", accessor: "priority" },
        { header: "Assignee", accessor: (r) => (r.assignedTo as any)?.fullName || "" },
        { header: "Project", accessor: (r) => (r.projectId as any)?.name || "N/A" },
        { header: "Due Date", accessor: (r) => (r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : "") },
        { header: "Actual Minutes", accessor: "actualMinutes" },
        { header: "Approval Status", accessor: "approvalStatus" },
      ];
      return {
        filename: `tasks_report_${timestamp}.csv`,
        csv: serializeToCsv(data.items, columns),
      };
    }

    case "leave":
    case "leaves": {
      const data = await getLeaveReport(authUser, queryParams);
      const columns: CsvColumn[] = [
        { header: "Employee", accessor: (r) => (r.userId as any)?.fullName || "" },
        { header: "Leave Type", accessor: "leaveType" },
        { header: "Status", accessor: "status" },
        { header: "Start Date", accessor: (r) => (r.startDate ? new Date(r.startDate).toISOString().slice(0, 10) : "") },
        { header: "End Date", accessor: (r) => (r.endDate ? new Date(r.endDate).toISOString().slice(0, 10) : "") },
        { header: "Total Days", accessor: "totalDays" },
        { header: "Reason", accessor: "reason" },
      ];
      return {
        filename: `leave_report_${timestamp}.csv`,
        csv: serializeToCsv(data.items, columns),
      };
    }

    case "eod": {
      const data = await getEodReport(authUser, queryParams);
      const columns: CsvColumn[] = [
        { header: "Report Date", accessor: (r) => (r.reportDate ? new Date(r.reportDate).toISOString().slice(0, 10) : "") },
        { header: "Employee", accessor: (r) => (r.userId as any)?.fullName || "" },
        { header: "Status", accessor: "status" },
        { header: "Tasks Completed", accessor: "tasksCompletedCount" },
        { header: "Hours Worked", accessor: "totalHoursWorked" },
        { header: "Summary", accessor: "summary" },
      ];
      return {
        filename: `eod_report_${timestamp}.csv`,
        csv: serializeToCsv(data.items, columns),
      };
    }

    default: {
      // General overview summary export
      const data = await getOverviewReport(authUser, queryParams);
      const rows = [
        { metric: "Total Employees", value: (data as any).kpis?.totalEmployees?.current ?? "N/A" },
        { metric: "Active Employees", value: (data as any).kpis?.activeEmployees?.current ?? "N/A" },
        { metric: "Attendance Rate (%)", value: (data as any).kpis?.attendanceRate?.current ?? "N/A" },
        { metric: "Task Completion Rate (%)", value: (data as any).kpis?.taskCompletionRate?.current ?? "N/A" },
        { metric: "EOD Submissions", value: (data as any).kpis?.eodSubmissions?.current ?? "N/A" },
        { metric: "Active Projects", value: (data as any).kpis?.activeProjects?.current ?? "N/A" },
      ];
      const columns: CsvColumn[] = [
        { header: "Executive Metric", accessor: "metric" },
        { header: "Value", accessor: "value" },
      ];
      return {
        filename: `overview_report_${timestamp}.csv`,
        csv: serializeToCsv(rows, columns),
      };
    }
  }
}
