import Division from "../models/Division";
import mongoose from "mongoose";
import Attendance from "../models/Attendance";
import WorkSession from "../models/WorkSession";
import AttendanceBreak from "../models/Break";
import User from "../models/User";
import Organization from "../models/Organization";
import DailyReport from "../models/DailyReport";
import TaskTimeSession from "../models/TaskTimeSession";
import Task from "../models/Task";
import { buildAttendanceSocketPayload, emitAttendanceEvent } from "../realtime/attendance";

const MS_PER_MINUTE = 60 * 1000;

function getTodayDateStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getTodayDateEnd(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function calculateDurationMs(start: Date, end: Date) {
  return Math.max(0, end.getTime() - start.getTime());
}

function formatMinutes(ms: number) {
  const totalMinutes = Math.round(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

async function getOrCreateTodayAttendance(userId: string, organizationId?: string | null) {
  const dayStart = getTodayDateStart();
  const dayEnd = getTodayDateEnd();

  let attendance = await Attendance.findOne({ userId, date: { $gte: dayStart, $lte: dayEnd } }).lean();

  if (!attendance) {
    const user: any = await User.findById(userId).lean();
    const created = await Attendance.create({
      userId,
      organizationId: organizationId || user?.organizationId || null,
      departmentId: user?.departmentId || null,
      teamId: user?.teamId || null,
      date: new Date(dayStart),
      attendanceStatus: "NOT_MARKED",
      totalWorkDuration: 0,
      totalBreakDuration: 0,
      currentStatus: "OFFLINE",
      firstLoginAt: null,
      lastLogoutAt: null,
      checkInTime: null,
      checkOutTime: null,
      workingDuration: 0,
    });
    attendance = created.toObject();
  }

  return attendance;
}

async function getActiveSessionForUser(userId: string) {
  return WorkSession.findOne({ userId, status: "ACTIVE" }).sort({ createdAt: -1 }).lean();
}

async function getActiveBreakForUser(userId: string) {
  return AttendanceBreak.findOne({ userId, status: "ACTIVE" }).sort({ createdAt: -1 }).lean();
}

export async function determineAttendanceStatus(loginAt: Date, workStartTime = "09:30", gracePeriodMinutes = 10) {
  const [hours, minutes] = workStartTime.split(":").map(Number);
  const workStart = new Date(loginAt);
  workStart.setHours(hours, minutes, 0, 0);

  const graceEnd = new Date(workStart.getTime() + gracePeriodMinutes * MS_PER_MINUTE);
  return loginAt.getTime() <= graceEnd.getTime() ? "PRESENT" : "LATE";
}

export async function loginAttendance(userId: string, deviceType = "WEB", workStartTime = "09:30", gracePeriodMinutes = 10) {
  if (!userId) throw new Error("USER_REQUIRED");

  const user: any = await User.findById(userId).lean();
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.status && user.status !== "ACTIVE") throw new Error("USER_INACTIVE");

  const existingActiveSession = await getActiveSessionForUser(userId);
  if (existingActiveSession) throw new Error("ACTIVE_SESSION_EXISTS");

  const attendance = await getOrCreateTodayAttendance(String(userId), user.organizationId ? String(user.organizationId) : null);
  const activeBreak = await getActiveBreakForUser(userId);
  if (activeBreak) throw new Error("ACTIVE_BREAK_EXISTS");

  const now = new Date();
  const currentStatus = attendance.currentStatus === "ON_BREAK" ? "ON_BREAK" : "ONLINE";

  const attendanceStatus = await determineAttendanceStatus(now, workStartTime, gracePeriodMinutes);

  const updatedAttendance = await Attendance.findByIdAndUpdate(
    attendance._id,
    {
      firstLoginAt: attendance.firstLoginAt ? attendance.firstLoginAt : now,
      checkInTime: (attendance as any).checkInTime || attendance.firstLoginAt || now,
      attendanceStatus,
      currentStatus,
      lastLogoutAt: null,
      checkOutTime: null,
      totalWorkDuration: attendance.totalWorkDuration || 0,
      workingDuration: (attendance as any).workingDuration || attendance.totalWorkDuration || 0,
      totalBreakDuration: attendance.totalBreakDuration || 0,
      departmentId: user.departmentId || attendance.departmentId || null,
      teamId: user.teamId || attendance.teamId || null,
    },
    { new: true }
  ).lean();

  const session = await WorkSession.create({
    userId,
    attendanceId: attendance._id,
    loginAt: now,
    logoutAt: null,
    duration: 0,
    status: "ACTIVE",
    deviceType,
  });

  const safeUser = await User.findById(userId).select("-passwordHash").lean();
  const payload = buildAttendanceSocketPayload(safeUser, "ONLINE");
  const scope = {
    organizationId: user.organizationId ? String(user.organizationId) : null,
    teamId: user.teamId ? String(user.teamId) : null,
    userId: String(userId),
  };

  emitAttendanceEvent("user:online", payload, scope);
  emitAttendanceEvent("attendance:updated", { ...payload, attendanceId: String(attendance._id), sessionId: String(session._id), attendanceStatus }, scope);

  return { attendance: updatedAttendance, session, user: safeUser };
}

export async function logoutAttendance(userId: string, options?: { bypassEod?: boolean }) {
  const activeSession = await getActiveSessionForUser(userId);
  if (!activeSession) throw new Error("NO_ACTIVE_SESSION");

  const attendance = await Attendance.findOne({ userId, date: { $gte: getTodayDateStart(), $lte: getTodayDateEnd() } }).lean();
  if (!attendance) throw new Error("ATTENDANCE_NOT_FOUND");

  const now = new Date();

  // If user is currently on break, auto-close the active break
  let extraBreakDuration = 0;
  const breakRecord = await getActiveBreakForUser(userId);
  if (breakRecord) {
    extraBreakDuration = calculateDurationMs(new Date(breakRecord.startedAt), now);
    await AttendanceBreak.findByIdAndUpdate(
      breakRecord._id,
      { endedAt: now, duration: extraBreakDuration, status: "COMPLETED" },
      { new: true }
    );
  }

  const user: any = await User.findById(userId).lean();
  if (!options?.bypassEod && user?.organizationId) {
    const org = await Organization.findById(user.organizationId).lean();
    const requiresEod = org?.settings?.dailyReportRequiredBeforeLogout ?? true;
    const todayReport = await DailyReport.findOne({ userId, reportDate: { $gte: getTodayDateStart(), $lte: getTodayDateEnd() } }).lean();
    if (requiresEod && (!todayReport || todayReport.status !== "SUBMITTED")) {
      throw new Error("EOD_REPORT_REQUIRED");
    }
  }

  const activeTaskTimer = await TaskTimeSession.findOne({ userId, status: "ACTIVE" }).sort({ createdAt: -1 }).lean();
  if (activeTaskTimer) {
    const elapsedSeconds = Math.max(0, (now.getTime() - new Date(activeTaskTimer.startedAt).getTime()) / 1000);
    const savedSeconds = Math.round((Number(activeTaskTimer.activeSeconds || 0) + elapsedSeconds));
    await TaskTimeSession.findByIdAndUpdate(
      activeTaskTimer._id,
      { activeSeconds: savedSeconds, status: "PAUSED", pausedAt: now, endedAt: now },
      { new: true }
    );
    if (activeTaskTimer.taskId) {
      await Task.findByIdAndUpdate(activeTaskTimer.taskId, { status: "PAUSED" }, { new: true });
    }
  }

  const duration = calculateDurationMs(new Date(activeSession.loginAt), now);

  const updatedSession = await WorkSession.findByIdAndUpdate(
    activeSession._id,
    { logoutAt: now, duration, status: "COMPLETED" },
    { new: true }
  ).lean();

  const attendanceTotal = (attendance.totalWorkDuration || 0) + duration;
  const totalBreakDuration = (attendance.totalBreakDuration || 0) + extraBreakDuration;
  const updatedAttendance = await Attendance.findByIdAndUpdate(
    attendance._id,
    {
      lastLogoutAt: now,
      checkOutTime: now,
      totalWorkDuration: attendanceTotal,
      workingDuration: attendanceTotal,
      totalBreakDuration,
      currentStatus: "OFFLINE",
      attendanceStatus: attendance.attendanceStatus || "PRESENT",
    },
    { new: true }
  ).lean();

  const safeUser = await User.findById(userId).select("-passwordHash").lean();
  const payload = buildAttendanceSocketPayload(safeUser, "OFFLINE");
  const scope = {
    organizationId: user?.organizationId ? String(user.organizationId) : null,
    teamId: user?.teamId ? String(user.teamId) : null,
    userId: String(userId),
  };

  emitAttendanceEvent("user:offline", payload, scope);
  emitAttendanceEvent("attendance:updated", { ...payload, attendanceId: String(attendance._id), sessionId: String(updatedSession?._id), attendanceStatus: updatedAttendance?.attendanceStatus }, scope);

  return { attendance: updatedAttendance, session: updatedSession, user: safeUser };
}

export async function startBreak(userId: string, type: "LUNCH" | "SHORT_BREAK" | "PERSONAL" | "OTHER") {
  const activeSession = await getActiveSessionForUser(userId);
  if (!activeSession) throw new Error("NO_ACTIVE_SESSION");

  const existingBreak = await getActiveBreakForUser(userId);
  if (existingBreak) throw new Error("ACTIVE_BREAK_EXISTS");

  const attendance = await Attendance.findOne({ userId, date: { $gte: getTodayDateStart(), $lte: getTodayDateEnd() } }).lean();
  if (!attendance) throw new Error("ATTENDANCE_NOT_FOUND");

  const startedAt = new Date();
  const breakRecord = await AttendanceBreak.create({
    userId,
    attendanceId: attendance._id,
    type,
    startedAt,
    endedAt: null,
    duration: 0,
    status: "ACTIVE",
  });

  const updatedAttendance = await Attendance.findByIdAndUpdate(
    attendance._id,
    { currentStatus: "ON_BREAK" },
    { new: true }
  ).lean();

  const safeUser: any = await User.findById(userId).select("-passwordHash").lean();
  const payload = buildAttendanceSocketPayload(safeUser, "ON_BREAK");
  const scope = {
    organizationId: safeUser?.organizationId ? String(safeUser.organizationId) : null,
    teamId: safeUser?.teamId ? String(safeUser.teamId) : null,
    userId: String(userId),
  };

  emitAttendanceEvent("user:break-start", payload, scope);
  emitAttendanceEvent("attendance:updated", { ...payload, attendanceId: String(attendance._id), breakId: String(breakRecord._id) }, scope);

  return { attendance: updatedAttendance, break: breakRecord, user: safeUser };
}

export async function endBreak(userId: string) {
  const activeBreak = await getActiveBreakForUser(userId);
  if (!activeBreak) throw new Error("NO_ACTIVE_BREAK");

  const attendance = await Attendance.findOne({ userId, date: { $gte: getTodayDateStart(), $lte: getTodayDateEnd() } }).lean();
  if (!attendance) throw new Error("ATTENDANCE_NOT_FOUND");

  const endedAt = new Date();
  const duration = calculateDurationMs(new Date(activeBreak.startedAt), endedAt);

  const updatedBreak = await AttendanceBreak.findByIdAndUpdate(
    activeBreak._id,
    { endedAt, duration, status: "COMPLETED" },
    { new: true }
  ).lean();

  const totalBreakDuration = (attendance.totalBreakDuration || 0) + duration;
  const updatedAttendance = await Attendance.findByIdAndUpdate(
    attendance._id,
    {
      totalBreakDuration,
      currentStatus: "ONLINE",
    },
    { new: true }
  ).lean();

  const safeUser: any = await User.findById(userId).select("-passwordHash").lean();
  const payload = buildAttendanceSocketPayload(safeUser, "ONLINE");
  const scope = {
    organizationId: safeUser?.organizationId ? String(safeUser.organizationId) : null,
    teamId: safeUser?.teamId ? String(safeUser.teamId) : null,
    userId: String(userId),
  };

  emitAttendanceEvent("user:break-end", payload, scope);
  emitAttendanceEvent("attendance:updated", { ...payload, attendanceId: String(attendance._id), breakId: String(updatedBreak?._id) }, scope);

  return { attendance: updatedAttendance, break: updatedBreak, user: safeUser };
}

export async function getTodayAttendanceForUser(userId: string) {
  const attendance = await Attendance.findOne({ userId, date: { $gte: getTodayDateStart(), $lte: getTodayDateEnd() } }).lean();
  if (!attendance) return null;

  const activeSession = await getActiveSessionForUser(userId);
  const activeBreak = await getActiveBreakForUser(userId);
  return {
    attendance,
    activeSession,
    activeBreak,
    workDurationText: formatMinutes(attendance.totalWorkDuration || 0),
    breakDurationText: formatMinutes(attendance.totalBreakDuration || 0),
  };
}

export async function getAttendanceHistoryForUser(userId: string, filters: Record<string, unknown> = {}) {
  const query: Record<string, unknown> = { userId };
  if (filters.dateFrom || filters.dateTo) {
    query.date = {} as Record<string, Date>;
    if (filters.dateFrom) (query.date as Record<string, Date>).$gte = new Date(String(filters.dateFrom));
    if (filters.dateTo) (query.date as Record<string, Date>).$lte = new Date(String(filters.dateTo));
  }
  if (filters.attendanceStatus) query.attendanceStatus = filters.attendanceStatus;

  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 20);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Attendance.find(query)
      .populate("userId", "fullName email employeeId designation role departmentId teamId")
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Attendance.countDocuments(query),
  ]);

  return { items, total, page, limit };
}

export async function getLiveAttendance(options: {
  userIds?: string[];
  organizationId?: string | null;
  divisionId?: string | null;
  teamIds?: string[];
} = {}) {
  const dayStart = getTodayDateStart();
  const dayEnd = getTodayDateEnd();

  const userQuery: Record<string, any> = { status: "ACTIVE" };
  if (options.organizationId) {
    userQuery.organizationId = options.organizationId;
  }
  if (options.divisionId) {
    userQuery.divisionId = options.divisionId;
  }
  if (options.userIds && options.userIds.length > 0) {
    userQuery._id = { $in: options.userIds };
  } else if (options.teamIds && options.teamIds.length > 0) {
    userQuery.teamId = { $in: options.teamIds };
  }

  const users = await User.find(userQuery)
    .select("-passwordHash")
    .lean();

  const userIds = users.map((u) => u._id);

  // Fetch today's attendance records for these users
  const attendances = await Attendance.find({
    userId: { $in: userIds },
    date: { $gte: dayStart, $lte: dayEnd },
  }).lean();
  const attendanceMap = new Map(attendances.map((a) => [String(a.userId), a]));

  // Fetch active sessions
  const activeSessions = await WorkSession.find({
    userId: { $in: userIds },
    status: "ACTIVE",
  }).lean();
  const sessionMap = new Map(activeSessions.map((s) => [String(s.userId), s]));

  // Fetch active breaks
  const activeBreaks = await AttendanceBreak.find({
    userId: { $in: userIds },
    status: "ACTIVE",
  }).lean();
  const breakMap = new Map(activeBreaks.map((b) => [String(b.userId), b]));

  const now = new Date();

  return users.map((user: any) => {
    const uId = String(user._id);
    const attendance = attendanceMap.get(uId);
    const activeSession = sessionMap.get(uId);
    const activeBreak = breakMap.get(uId);

    let currentStatus = "OFFLINE";
    if (activeBreak) {
      currentStatus = "ON_BREAK";
    } else if (activeSession) {
      currentStatus = "ONLINE";
    } else if (attendance?.currentStatus === "LOGGED_OUT") {
      currentStatus = "LOGGED_OUT";
    }

    let liveWorkMs = attendance?.totalWorkDuration || 0;
    if (activeSession && !activeBreak) {
      liveWorkMs += calculateDurationMs(new Date(activeSession.loginAt), now);
    }

    let liveBreakMs = attendance?.totalBreakDuration || 0;
    if (activeBreak) {
      liveBreakMs += calculateDurationMs(new Date(activeBreak.startedAt), now);
    }

    return {
      userId: uId,
      employeeId: user.employeeId || "",
      fullName: user.fullName || "",
      designation: user.designation || "",
      employmentType: user.employmentType || "EMPLOYEE",
      role: user.role || "EMPLOYEE",
      division: user.divisionId || null,
      department: user.departmentId || null,
      team: user.teamId || null,
      currentStatus,
      attendanceStatus: attendance?.attendanceStatus || "NOT_MARKED",
      checkInTime: attendance?.firstLoginAt || activeSession?.loginAt || null,
      checkOutTime: attendance?.lastLogoutAt || null,
      isLate: (attendance?.attendanceStatus === "LATE"),
      firstLoginAt: attendance?.firstLoginAt || activeSession?.loginAt || null,
      lastLogoutAt: attendance?.lastLogoutAt || null,
      workingDuration: (attendance as any)?.workingDuration || attendance?.totalWorkDuration || liveWorkMs,
      workingDurationFormatted: formatMinutes((attendance as any)?.workingDuration || attendance?.totalWorkDuration || liveWorkMs),
      currentWorkDuration: liveWorkMs,
      currentBreakDuration: liveBreakMs,
      workDurationText: formatMinutes(liveWorkMs),
      breakDurationText: formatMinutes(liveBreakMs),
      isOnBreak: Boolean(activeBreak),
      activeBreakType: activeBreak?.type || null,
    };
  });
}

export async function correctAttendance(
  attendanceId: string,
  payload: { attendanceStatus?: "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE"; totalWorkDuration?: number; reason: string },
  actorUser: any
) {
  const attendance = await Attendance.findById(attendanceId).lean();
  if (!attendance) throw new Error("ATTENDANCE_NOT_FOUND");

  const correctionEntry = {
    correctedBy: actorUser._id || actorUser.id,
    previousStatus: attendance.attendanceStatus,
    newStatus: payload.attendanceStatus || attendance.attendanceStatus,
    previousTotalWorkDuration: attendance.totalWorkDuration,
    newTotalWorkDuration: payload.totalWorkDuration !== undefined ? payload.totalWorkDuration : attendance.totalWorkDuration,
    reason: payload.reason || "Administrative attendance correction",
    correctedAt: new Date(),
  };

  const updateDoc: Record<string, any> = {
    $push: { corrections: correctionEntry },
  };

  if (payload.attendanceStatus) {
    updateDoc.attendanceStatus = payload.attendanceStatus;
  }
  if (payload.totalWorkDuration !== undefined) {
    updateDoc.totalWorkDuration = Number(payload.totalWorkDuration);
  }

  const updated = await Attendance.findByIdAndUpdate(attendanceId, updateDoc, { new: true })
    .populate("userId", "fullName email employeeId designation role")
    .lean();

  return updated;
}

export { formatMinutes };

/**
 * Finalizes un-checked-in employees as ABSENT or ON_LEAVE at the end of the workday cutoff.
 */
export async function finalizeDailyAbsentees(options: {
  organizationId?: string | null;
  targetDate?: Date;
} = {}) {
  const targetDate = options.targetDate || new Date();
  const dayStart = getTodayDateStart(targetDate);
  const dayEnd = getTodayDateEnd(targetDate);

  const userQuery: any = {
    status: "ACTIVE",
    employmentStatus: { $in: ["ACTIVE", "CONFIRMED", "PROBATION"] },
  };
  if (options.organizationId) {
    userQuery.organizationId = options.organizationId;
  }

  const activeUsers = await User.find(userQuery).select("_id organizationId departmentId teamId divisionId").lean();

  const results = {
    evaluated: activeUsers.length,
    finalizedAbsent: 0,
    markedOnLeave: 0,
    alreadyPresent: 0,
  };

  const Leave = (await import("../models/Leave")).default;

  for (const user of activeUsers) {
    const userId = String(user._id);

    let attendance = await Attendance.findOne({
      userId,
      date: { $gte: dayStart, $lte: dayEnd },
    });

    if (attendance && (attendance.attendanceStatus === "PRESENT" || attendance.attendanceStatus === "LATE")) {
      results.alreadyPresent++;
      continue;
    }

    const approvedLeave = await Leave.findOne({
      userId,
      status: "APPROVED",
      startDate: { $lte: dayEnd },
      endDate: { $gte: dayStart },
    }).lean();

    const finalStatus = approvedLeave ? "ON_LEAVE" : "ABSENT";

    if (!attendance) {
      await Attendance.create({
        userId,
        organizationId: user.organizationId || null,
        departmentId: user.departmentId || null,
        teamId: user.teamId || null,
        date: new Date(dayStart),
        attendanceStatus: finalStatus,
        totalWorkDuration: 0,
        totalBreakDuration: 0,
        currentStatus: "OFFLINE",
        firstLoginAt: null,
        lastLogoutAt: null,
        checkInTime: null,
        checkOutTime: null,
        workingDuration: 0,
      });
    } else {
      attendance.attendanceStatus = finalStatus;
      await attendance.save();
    }

    if (finalStatus === "ON_LEAVE") {
      results.markedOnLeave++;
    } else {
      results.finalizedAbsent++;
    }
  }

  return results;
}

export const checkInAttendance = loginAttendance;
export const checkOutAttendance = logoutAttendance;


