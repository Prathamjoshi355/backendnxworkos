import mongoose from "mongoose";
import crypto from "crypto";
import User, { IUser } from "../models/User";
import Department from "../models/Department";
import Team from "../models/Team";
import Attendance from "../models/Attendance";
import Leave from "../models/Leave";
import { PerformanceSnapshot } from "../models/PerformanceSnapshot";
import Compensation from "../models/Compensation";
import EmployeeDocument from "../models/EmployeeDocument";
import { recordAuditLog } from "./auditLogService";
import { createNotification } from "./notificationService";
import {
  emitEmployeeCreated,
  emitEmployeeUpdated,
  emitEmployeeStatusUpdated,
  emitOnboardingUpdated,
  emitOffboardingUpdated,
} from "../lib/socketEmitters";

export const DEFAULT_ONBOARDING_CHECKLIST = [
  { key: "DOCUMENT_SUBMISSION", title: "Submit mandatory onboarding documents & ID proof" },
  { key: "PROFILE_COMPLETION", title: "Complete personal, contact & emergency details" },
  { key: "POLICY_ACKNOWLEDGMENT", title: "Review & accept Employee Handbook and Workplace Policies" },
  { key: "IT_EQUIPMENT_SETUP", title: "Provision workstation, credentials & corporate email" },
  { key: "ORIENTATION_SESSION", title: "Attend company introduction & departmental briefing" },
];

export const VALID_LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  INVITED: ["ACTIVE", "INACTIVE", "PROBATION", "CONFIRMED"],
  ACTIVE: ["PROBATION", "CONFIRMED", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED", "INACTIVE", "TERMINATED", "RESIGNED", "EXITED"],
  PROBATION: ["CONFIRMED", "ACTIVE", "NOTICE_PERIOD", "TERMINATED", "RESIGNED", "SUSPENDED", "EXITED"],
  CONFIRMED: ["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED", "INACTIVE", "TERMINATED", "RESIGNED", "EXITED"],
  ON_LEAVE: ["ACTIVE", "NOTICE_PERIOD", "RESIGNED", "EXITED", "SUSPENDED"],
  NOTICE_PERIOD: ["EXITED", "RESIGNED", "TERMINATED", "ACTIVE", "CONFIRMED"],
  SUSPENDED: ["ACTIVE", "TERMINATED", "INACTIVE", "EXITED", "CONFIRMED", "PROBATION"],
  INACTIVE: ["ACTIVE", "TERMINATED", "EXITED", "CONFIRMED", "PROBATION"],
  TERMINATED: ["EXITED", "ACTIVE", "CONFIRMED", "PROBATION"],
  RESIGNED: ["EXITED", "ACTIVE", "CONFIRMED", "PROBATION"],
  EXITED: ["ACTIVE", "CONFIRMED", "PROBATION"],
};

export function isHrOrAdmin(user: any): boolean {
  if (!user) return false;
  return (
    user.role === "SUPER_ADMIN" ||
    user.role === "ADMIN" ||
    user.role === "HR" ||
    (Array.isArray(user.permissions) && (user.permissions.includes("hr.manage") || user.permissions.includes("users.manage")))
  );
}

/**
 * Validate manager assignment to prevent:
 * - self-management
 * - cross-organization assignment
 * - circular reporting
 */
export async function validateManagerAssignment(
  targetUserId: string,
  managerId: string,
  organizationId: string
): Promise<void> {
  if (String(targetUserId) === String(managerId)) {
    throw new Error("CANNOT_MANAGE_SELF");
  }

  const manager = await User.findById(managerId).lean();
  if (!manager) {
    throw new Error("MANAGER_NOT_FOUND");
  }

  if (manager.organizationId && String(manager.organizationId) !== String(organizationId)) {
    throw new Error("MANAGER_CROSS_ORG_FORBIDDEN");
  }

  // Circular reporting check (traverse up to 10 levels)
  let currentManagerId: string | null = manager.reportingManagerId ? String(manager.reportingManagerId) : null;
  let depth = 0;
  while (currentManagerId && depth < 10) {
    if (String(currentManagerId) === String(targetUserId)) {
      throw new Error("CIRCULAR_REPORTING_DETECTED");
    }
    const sup: any = await User.findById(currentManagerId).select("reportingManagerId").lean();
    currentManagerId = sup?.reportingManagerId ? String(sup.reportingManagerId) : null;
    depth++;
  }
}

/**
 * Get high-level HR metrics overview for the organization
 */
export async function getHrOverview(authUser: any, orgIdParam?: string) {
  const orgId = authUser.role === "SUPER_ADMIN" && orgIdParam ? orgIdParam : authUser.organizationId;
  if (!orgId) throw new Error("ORGANIZATION_ID_REQUIRED");

  const filter = { organizationId: orgId };

  // Auto-clean any stale team assignments for exited employees in this organization
  await User.updateMany(
    {
      ...filter,
      $or: [{ status: "EXITED" }, { status: "TERMINATED" }, { status: "RESIGNED" }],
      teamId: { $ne: null },
    },
    { $unset: { teamId: 1 } }
  );

  const [
    totalEmployees,
    activeEmployees,
    probationEmployees,
    confirmedEmployees,
    onLeaveEmployees,
    noticePeriodEmployees,
    exitedEmployees,
    pendingOnboardingCount,
    departments,
  ] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments({ ...filter, status: "ACTIVE" }),
    User.countDocuments({ ...filter, $or: [{ status: "PROBATION" }, { employmentStatus: "PROBATION" }] }),
    User.countDocuments({ ...filter, $or: [{ status: "CONFIRMED" }, { employmentStatus: "CONFIRMED" }] }),
    User.countDocuments({ ...filter, $or: [{ status: "ON_LEAVE" }, { employmentStatus: "ON_LEAVE" }] }),
    User.countDocuments({ ...filter, $or: [{ status: "NOTICE_PERIOD" }, { employmentStatus: "NOTICE_PERIOD" }] }),
    User.countDocuments({ ...filter, $or: [{ status: "EXITED" }, { status: "TERMINATED" }, { status: "RESIGNED" }] }),
    User.countDocuments({ ...filter, onboardingStatus: { $in: ["PENDING", "IN_PROGRESS"] } }),
    Department.find(filter).select("_id name code").lean(),
  ]);

  const deptCounts = await Promise.all(
    departments.map(async (d) => {
      const count = await User.countDocuments({
        ...filter,
        departmentId: String(d._id),
        status: { $nin: ["EXITED", "TERMINATED", "RESIGNED", "INACTIVE"] },
      });
      return {
        departmentId: String(d._id),
        name: d.name,
        code: d.code,
        count,
      };
    })
  );

  return {
    totalEmployees,
    activeEmployees,
    probationEmployees,
    confirmedEmployees,
    onLeaveEmployees,
    noticePeriodEmployees,
    exitedEmployees,
    pendingOnboardingCount,
    departments: deptCounts,
  };
}

/**
 * List employees with advanced HR filtering, pagination, and role-based field masking
 */
export async function listEmployees(authUser: any, query: any) {
  const orgId = authUser.role === "SUPER_ADMIN" && query.organizationId ? query.organizationId : authUser.organizationId;
  if (!orgId) throw new Error("ORGANIZATION_ID_REQUIRED");

  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
  const skip = (page - 1) * limit;

  const q: any = { organizationId: orgId };

  if (query.search && query.search.trim().length > 0) {
    const s = new RegExp(query.search.trim(), "i");
    q.$or = [{ employeeId: s }, { fullName: s }, { email: s }, { designation: s }];
  }

  if (query.departmentId) q.departmentId = query.departmentId;
  if (query.teamId) q.teamId = query.teamId;
  if (query.designation) q.designation = new RegExp(query.designation.trim(), "i");
  if (query.role) q.role = query.role;
  if (query.employmentType) q.employmentType = query.employmentType;
  if (query.employmentStatus) {
    q.$or = [{ employmentStatus: query.employmentStatus }, { status: query.employmentStatus }];
  }
  if (query.onboardingStatus) q.onboardingStatus = query.onboardingStatus;
  if (query.activeOnly === "true" || query.activeOnly === true) {
    q.status = { $in: ["ACTIVE", "PROBATION", "CONFIRMED"] };
  }

  const [items, total] = await Promise.all([
    User.find(q)
      .select("-passwordHash")
      .populate("reportingManagerId", "fullName email employeeId designation")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(q),
  ]);

  const privileged = isHrOrAdmin(authUser);
  const authUserId = String(authUser._id || authUser.id);

  // Mask sensitive fields if requester is not HR/Admin and viewing other users
  const sanitizedItems = items.map((u: any) => {
    const isSelf = String(u._id) === authUserId;
    if (privileged || isSelf) {
      return u;
    }

    // Public directory fields only
    return {
      _id: u._id,
      id: u._id,
      employeeId: u.employeeId,
      fullName: u.fullName,
      displayName: u.displayName || u.fullName,
      email: u.officialEmail || u.email,
      role: u.role,
      designation: u.designation,
      departmentId: u.departmentId,
      teamId: u.teamId,
      reportingManagerId: u.reportingManagerId,
      workLocation: u.workLocation,
      workMode: u.workMode,
      status: u.status,
      joiningDate: u.joiningDate,
      profilePhoto: u.profilePhoto,
    };
  });

  return {
    items: sanitizedItems,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get unified Employee HR Profile aggregating User details, Attendance stats,
 * Leave balances, Performance scorecard, Compensation (auth only), Documents,
 * Onboarding/Offboarding status, and HR notes (auth only).
 */
export async function getEmployeeHrProfile(authUser: any, targetUserId: string) {
  const user = await User.findById(targetUserId).select("-passwordHash").lean();
  if (!user) throw new Error("EMPLOYEE_NOT_FOUND");

  // Organization isolation
  if (authUser.role !== "SUPER_ADMIN") {
    if (user.organizationId && String(user.organizationId) !== String(authUser.organizationId)) {
      throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
    }
  }

  const privileged = isHrOrAdmin(authUser);
  const isSelf = String(authUser._id || authUser.id) === String(targetUserId);

  if (!privileged && !isSelf) {
    // Non-HR colleagues can only access basic directory card
    return {
      user: {
        _id: user._id,
        id: user._id,
        employeeId: user.employeeId,
        fullName: user.fullName,
        displayName: user.displayName || user.fullName,
        email: user.officialEmail || user.email,
        role: user.role,
        designation: user.designation,
        departmentId: user.departmentId,
        teamId: user.teamId,
        workLocation: user.workLocation,
        workMode: user.workMode,
        status: user.status,
        joiningDate: user.joiningDate,
      },
    };
  }

  // Aggregate organizational hierarchy details
  const [department, team, manager] = await Promise.all([
    user.departmentId ? Department.findById(user.departmentId).select("_id name code").lean() : null,
    user.teamId ? Team.findById(user.teamId).select("_id name code teamLeadId").lean() : null,
    user.reportingManagerId ? User.findById(user.reportingManagerId).select("_id fullName email employeeId designation").lean() : null,
  ]);

  // Aggregate Attendance Summary (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const attendanceRecords = await Attendance.find({
    userId: targetUserId,
    date: { $gte: thirtyDaysAgo },
  }).lean();

  const presentDays = attendanceRecords.filter((a) => a.attendanceStatus === "PRESENT").length;
  const absentDays = attendanceRecords.filter((a) => a.attendanceStatus === "ABSENT").length;
  const lateDays = attendanceRecords.filter((a) => a.attendanceStatus === "LATE").length;
  const totalTrackedDays = attendanceRecords.length;
  const attendanceRate = totalTrackedDays > 0 ? Math.round((presentDays / totalTrackedDays) * 100) : 100;

  // Aggregate Leave Summary
  const [leaveBalances, pendingLeaves] = await Promise.all([
    (await import("./leaveService")).getLeaveBalance(targetUserId, String(user.organizationId || "")),
    Leave.find({ userId: targetUserId, status: "PENDING" }).sort({ startDate: -1 }).limit(5).lean(),
  ]);

  // Aggregate Performance Scorecard
  const latestSnapshot = await PerformanceSnapshot.findOne({ userId: targetUserId })
    .sort({ periodEnd: -1 })
    .lean();

  // Aggregate Documents
  const documents = await EmployeeDocument.find({ userId: targetUserId }).sort({ createdAt: -1 }).lean();

  // Aggregate Compensation (Strictly role-gated)
  let compensation: any = null;
  let compensationHistory: any = null;
  if (privileged || isSelf) {
    compensation = await Compensation.findOne({ userId: targetUserId, status: "ACTIVE" }).sort({ effectiveFrom: -1 }).lean();
    if (privileged) {
      compensationHistory = await Compensation.find({ userId: targetUserId }).sort({ effectiveFrom: -1 }).lean();
    }
  }

  return {
    user: {
      ...user,
      departmentName: department?.name || null,
      teamName: team?.name || null,
      managerName: manager?.fullName || null,
      department,
      team,
      manager,
      hrNotes: privileged ? user.hrNotes || [] : undefined,
    },
    attendanceSummary: {
      presentDays,
      absentDays,
      lateDays,
      totalTrackedDays,
      attendanceRate,
    },
    leaveSummary: {
      balances: leaveBalances,
      pendingRequests: pendingLeaves,
    },
    performanceSummary: latestSnapshot
      ? {
          performanceScore: latestSnapshot.performanceScore,
          taskCompletionScore: latestSnapshot.taskCompletionScore,
          timelinessScore: latestSnapshot.timelinessScore,
          attendanceScore: latestSnapshot.attendanceScore,
          periodType: latestSnapshot.periodType,
          calculatedAt: latestSnapshot.calculatedAt,
        }
      : null,
    compensation: compensation
      ? {
          baseAmount: compensation.baseAmount,
          currency: compensation.currency,
          payFrequency: compensation.payFrequency,
          type: compensation.compensationType,
          effectiveFrom: compensation.effectiveFrom,
          status: compensation.status,
          history: compensationHistory,
        }
      : null,
    documents,
    onboarding: {
      status: user.onboardingStatus || "COMPLETED",
      checklist: user.onboardingChecklist || [],
    },
    offboarding: {
      exitDate: user.exitDate,
      exitNoticeDate: user.exitNoticeDate,
      exitReason: privileged ? user.exitReason : undefined,
      clearanceStatus: user.exitClearanceStatus || { it: false, finance: false, admin: false, hr: false },
    },
  };
}

/**
 * Update employee lifecycle state
 */
export async function updateEmployeeLifecycle(authUser: any, targetUserId: string, payload: any) {
  if (!isHrOrAdmin(authUser)) {
    throw new Error("FORBIDDEN_HR_ACTION");
  }

  const user = await User.findById(targetUserId);
  if (!user) throw new Error("EMPLOYEE_NOT_FOUND");

  if (authUser.role !== "SUPER_ADMIN" && String(user.organizationId) !== String(authUser.organizationId)) {
    throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
  }

  const currentStatus = user.employmentStatus || user.status || "ACTIVE";
  const newStatus = payload.status || payload.employmentStatus;

  if (!newStatus) throw new Error("NEW_STATUS_REQUIRED");

  // Validate state transition
  const allowed = VALID_LIFECYCLE_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`INVALID_LIFECYCLE_TRANSITION: Cannot transition from ${currentStatus} to ${newStatus}`);
  }

  user.status = newStatus;
  user.employmentStatus = newStatus;

  if (newStatus === "CONFIRMED") {
    user.confirmationDate = payload.confirmationDate ? new Date(payload.confirmationDate) : new Date();
  } else if (newStatus === "PROBATION") {
    if (payload.probationEndDate) user.probationEndDate = new Date(payload.probationEndDate);
  } else if (newStatus === "NOTICE_PERIOD") {
    user.exitNoticeDate = payload.exitNoticeDate ? new Date(payload.exitNoticeDate) : new Date();
    if (payload.exitDate) user.exitDate = new Date(payload.exitDate);
    if (payload.exitReason) user.exitReason = payload.exitReason;
  } else if (newStatus === "EXITED" || newStatus === "TERMINATED" || newStatus === "RESIGNED") {
    user.exitDate = payload.exitDate ? new Date(payload.exitDate) : new Date();
    if (payload.exitReason) user.exitReason = payload.exitReason;
    user.teamId = null;

    // Remove exited employee from leadership roles on teams and departments
    await Team.updateMany({ teamLeadId: user._id }, { $unset: { teamLeadId: 1 } });
    await Team.updateMany({ managerId: user._id }, { $unset: { managerId: 1 } });
    await Department.updateMany({ headId: user._id }, { $unset: { headId: 1 } });
  }

  await user.save();

  await recordAuditLog({
    organizationId: String(user.organizationId || ""),
    actorId: String(authUser._id || authUser.id),
    actorRole: authUser.role,
    action: "EMPLOYEE_LIFECYCLE_UPDATED",
    entityType: "USER",
    entityId: String(user._id),
    summary: `Updated lifecycle of ${user.fullName} from ${currentStatus} to ${newStatus}`,
    metadata: {
      previousStatus: currentStatus,
      newStatus,
      reason: payload.exitReason || payload.reason,
    },
  });

  emitEmployeeStatusUpdated(user._id, { previousStatus: currentStatus, newStatus }, user.organizationId || undefined);
  emitEmployeeUpdated(user, user.organizationId || undefined);

  // Notify employee
  await createNotification({
    recipientId: String(user._id),
    organizationId: String(user.organizationId || ""),
    title: "Employment Status Updated",
    message: `Your employment status has been updated to ${newStatus}.`,
    type: "GENERAL",
    priority: "NORMAL",
  });

  return user.toObject();
}

/**
 * Initialize or update employee onboarding checklist
 */
export async function updateOnboardingChecklist(
  authUser: any,
  targetUserId: string,
  itemKey: string,
  completed: boolean
) {
  if (!isHrOrAdmin(authUser)) throw new Error("FORBIDDEN_HR_ACTION");

  const user = await User.findById(targetUserId);
  if (!user) throw new Error("EMPLOYEE_NOT_FOUND");

  if (authUser.role !== "SUPER_ADMIN" && String(user.organizationId) !== String(authUser.organizationId)) {
    throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
  }

  // Initialize checklist if missing
  if (!user.onboardingChecklist || user.onboardingChecklist.length === 0) {
    user.onboardingChecklist = DEFAULT_ONBOARDING_CHECKLIST.map((c) => ({
      key: c.key,
      title: c.title,
      completed: false,
      completedAt: null,
      completedBy: null,
    }));
  }

  const itemIndex = user.onboardingChecklist.findIndex((i) => i.key === itemKey);
  if (itemIndex === -1) {
    throw new Error("CHECKLIST_ITEM_NOT_FOUND");
  }

  user.onboardingChecklist[itemIndex].completed = completed;
  user.onboardingChecklist[itemIndex].completedAt = completed ? new Date() : null;
  user.onboardingChecklist[itemIndex].completedBy = completed ? authUser.fullName || authUser.email : null;

  // Recalculate status
  const total = user.onboardingChecklist.length;
  const done = user.onboardingChecklist.filter((i) => i.completed).length;

  if (done === total) {
    user.onboardingStatus = "COMPLETED";
  } else if (done > 0) {
    user.onboardingStatus = "IN_PROGRESS";
  } else {
    user.onboardingStatus = "PENDING";
  }

  await user.save();

  await recordAuditLog({
    organizationId: String(user.organizationId || ""),
    actorId: String(authUser._id || authUser.id),
    actorRole: authUser.role,
    action: "ONBOARDING_CHECKLIST_UPDATED",
    entityType: "USER",
    entityId: String(user._id),
    summary: `Updated onboarding task '${itemKey}' to ${completed ? "COMPLETED" : "PENDING"} for ${user.fullName}`,
    metadata: { itemKey, completed, progress: `${done}/${total}` },
  });

  emitOnboardingUpdated(
    user._id,
    { itemKey, completed, onboardingStatus: user.onboardingStatus, progress: `${done}/${total}` },
    user.organizationId || undefined
  );

  return {
    onboardingStatus: user.onboardingStatus,
    checklist: user.onboardingChecklist,
  };
}

/**
 * Update employee offboarding clearance checklist
 */
export async function updateOffboardingClearance(
  authUser: any,
  targetUserId: string,
  department: "it" | "finance" | "admin" | "hr",
  cleared: boolean
) {
  if (!isHrOrAdmin(authUser)) throw new Error("FORBIDDEN_HR_ACTION");

  const user = await User.findById(targetUserId);
  if (!user) throw new Error("EMPLOYEE_NOT_FOUND");

  if (authUser.role !== "SUPER_ADMIN" && String(user.organizationId) !== String(authUser.organizationId)) {
    throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
  }

  if (!user.exitClearanceStatus) {
    user.exitClearanceStatus = { it: false, finance: false, admin: false, hr: false };
  }

  user.exitClearanceStatus[department] = cleared;
  user.markModified("exitClearanceStatus");
  await user.save();

  await recordAuditLog({
    organizationId: String(user.organizationId || ""),
    actorId: String(authUser._id || authUser.id),
    actorRole: authUser.role,
    action: "OFFBOARDING_CLEARANCE_UPDATED",
    entityType: "USER",
    entityId: String(user._id),
    summary: `Updated ${department.toUpperCase()} clearance to ${cleared ? "CLEARED" : "PENDING"} for ${user.fullName}`,
    metadata: { department, cleared },
  });

  emitOffboardingUpdated(
    user._id,
    { department, cleared, clearanceStatus: user.exitClearanceStatus },
    user.organizationId || undefined
  );

  return user.exitClearanceStatus;
}

/**
 * Add a confidential HR Note
 */
export async function addHrNote(authUser: any, targetUserId: string, noteText: string) {
  if (!isHrOrAdmin(authUser)) throw new Error("FORBIDDEN_HR_ACTION");
  if (!noteText || noteText.trim().length === 0) throw new Error("NOTE_TEXT_REQUIRED");

  const user = await User.findById(targetUserId);
  if (!user) throw new Error("EMPLOYEE_NOT_FOUND");

  if (authUser.role !== "SUPER_ADMIN" && String(user.organizationId) !== String(authUser.organizationId)) {
    throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
  }

  const noteId = crypto.randomUUID();
  const note = {
    id: noteId,
    authorId: authUser._id || authUser.id,
    authorName: authUser.fullName || authUser.displayName || authUser.email,
    note: noteText.trim(),
    createdAt: new Date(),
  };

  if (!user.hrNotes) user.hrNotes = [];
  user.hrNotes.push(note);
  await user.save();

  await recordAuditLog({
    organizationId: String(user.organizationId || ""),
    actorId: String(authUser._id || authUser.id),
    actorRole: authUser.role,
    action: "HR_NOTE_ADDED",
    entityType: "USER",
    entityId: String(user._id),
    summary: `Added confidential HR note on ${user.fullName}`,
    metadata: { noteId },
  });

  return note;
}

/**
 * Delete a confidential HR Note
 */
export async function deleteHrNote(authUser: any, targetUserId: string, noteId: string) {
  if (!isHrOrAdmin(authUser)) throw new Error("FORBIDDEN_HR_ACTION");

  const user = await User.findById(targetUserId);
  if (!user) throw new Error("EMPLOYEE_NOT_FOUND");

  if (authUser.role !== "SUPER_ADMIN" && String(user.organizationId) !== String(authUser.organizationId)) {
    throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
  }

  if (!user.hrNotes) return { success: true };

  const initialLen = user.hrNotes.length;
  user.hrNotes = user.hrNotes.filter((n) => n.id !== noteId);

  if (user.hrNotes.length !== initialLen) {
    await user.save();
    await recordAuditLog({
      organizationId: String(user.organizationId || ""),
      actorId: String(authUser._id || authUser.id),
      actorRole: authUser.role,
      action: "HR_NOTE_DELETED",
      entityType: "USER",
      entityId: String(user._id),
      summary: `Deleted HR note from ${user.fullName}`,
      metadata: { noteId },
    });
  }

  return { success: true };
}
