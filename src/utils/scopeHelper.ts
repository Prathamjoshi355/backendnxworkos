import mongoose from "mongoose";
import Team from "../models/Team";
import User from "../models/User";

export interface IManagementScope {
  role: string;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isTeamLeader: boolean;
  isEmployee: boolean;
  organizationId: string | null;
  managedTeamIds: string[];
  scopedUserIds: string[];
}

/**
 * Derives the active management and organizational scope for an authenticated user.
 */
export async function getManagementScope(user: any): Promise<IManagementScope> {
  const userId = String(user._id || user.id);
  const role = user.role || "EMPLOYEE";
  const orgId = user.organizationId ? String(user.organizationId) : null;

  const isSuperAdmin = role === "SUPER_ADMIN";
  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER";
  const isTeamLeader = role === "TEAM_LEADER";
  const isEmployee = !isSuperAdmin && !isAdmin && !isManager && !isTeamLeader;

  if (isSuperAdmin) {
    return {
      role,
      isSuperAdmin: true,
      isAdmin: false,
      isManager: false,
      isTeamLeader: false,
      isEmployee: false,
      organizationId: orgId,
      managedTeamIds: [],
      scopedUserIds: [],
    };
  }

  if (isAdmin) {
    return {
      role,
      isSuperAdmin: false,
      isAdmin: true,
      isManager: false,
      isTeamLeader: false,
      isEmployee: false,
      organizationId: orgId,
      managedTeamIds: [],
      scopedUserIds: [],
    };
  }

  let managedTeamIds: string[] = [];
  let scopedUserIds: string[] = [userId];

  if (isManager) {
    // A Manager can manage MULTIPLE teams where managerId == user._id
    const teams = await Team.find({
      organizationId: orgId,
      managerId: userId,
      status: "ACTIVE",
    }).select("_id teamLeadId").lean();

    managedTeamIds = teams.map((t) => String(t._id));

    const teamLeadIds = teams
      .map((t) => (t.teamLeadId ? String(t.teamLeadId) : null))
      .filter((id): id is string => Boolean(id));

    if (managedTeamIds.length > 0 || teamLeadIds.length > 0) {
      const teamMembers = await User.find({
        organizationId: orgId,
        $or: [
          ...(managedTeamIds.length > 0 ? [{ teamId: { $in: managedTeamIds } }] : []),
          ...(teamLeadIds.length > 0 ? [{ _id: { $in: teamLeadIds } }] : []),
          { reportingManagerId: userId },
          { _id: userId },
        ],
      }).select("_id").lean();

      scopedUserIds = [...new Set(teamMembers.map((m) => String(m._id)))];
    }
  } else if (isTeamLeader) {
    // A Team Leader manages their specific assigned team
    const teams = await Team.find({
      organizationId: orgId,
      $or: [
        { teamLeadId: userId },
        ...(user.teamId ? [{ _id: user.teamId }] : []),
      ],
      status: "ACTIVE",
    }).select("_id").lean();

    managedTeamIds = teams.map((t) => String(t._id));

    if (managedTeamIds.length > 0) {
      const teamMembers = await User.find({
        organizationId: orgId,
        teamId: { $in: managedTeamIds },
      }).select("_id").lean();

      scopedUserIds = [...new Set([userId, ...teamMembers.map((m) => String(m._id))])];
    }
  }

  return {
    role,
    isSuperAdmin: false,
    isAdmin: false,
    isManager,
    isTeamLeader,
    isEmployee,
    organizationId: orgId,
    managedTeamIds,
    scopedUserIds,
  };
}

/**
 * Validates whether the authenticated user has authority to assign work/tasks to target user or team.
 */
export async function canUserAssignWorkTo(
  user: any,
  options: { targetUserId?: string | null; targetTeamId?: string | null }
): Promise<boolean> {
  const userId = String(user._id || user.id);
  const role = user.role || "EMPLOYEE";
  const orgId = user.organizationId ? String(user.organizationId) : null;

  // Super Admin can assign work system-wide
  if (role === "SUPER_ADMIN") return true;

  // Admin can directly assign to ANY user or team within their organization
  if (role === "ADMIN") {
    if (options.targetUserId) {
      const target = await User.findById(options.targetUserId).select("organizationId").lean();
      if (!target || String(target.organizationId) !== orgId) return false;
    }
    if (options.targetTeamId) {
      const targetTeam = await Team.findById(options.targetTeamId).select("organizationId").lean();
      if (!targetTeam || String(targetTeam.organizationId) !== orgId) return false;
    }
    return true;
  }

  const scope = await getManagementScope(user);

  // If a target team is specified, user must have authority over that team
  if (options.targetTeamId) {
    if (scope.isManager && !scope.managedTeamIds.includes(String(options.targetTeamId))) {
      return false;
    }
    if (scope.isTeamLeader && !scope.managedTeamIds.includes(String(options.targetTeamId))) {
      return false;
    }
    if (scope.isEmployee) {
      if (!user.teamId || String(user.teamId) !== String(options.targetTeamId)) {
        return false;
      }
    }
  }

  // Self-assignment is permitted (subject to team authority above)
  if (options.targetUserId && String(options.targetUserId) === userId) {
    return true;
  }

  // Manager authority check
  if (scope.isManager) {
    if (options.targetUserId && !scope.scopedUserIds.includes(String(options.targetUserId))) {
      return false;
    }
    return true;
  }

  // Team Leader authority check
  if (scope.isTeamLeader) {
    if (options.targetUserId && !scope.scopedUserIds.includes(String(options.targetUserId))) {
      return false;
    }
    return true;
  }

  // Regular employees cannot assign work to other employees
  return false;
}

/**
 * Checks whether setting targetManagerId for userId would create a circular reporting chain.
 * Returns true if a cycle is detected, false otherwise.
 */
export async function detectCircularReporting(userId: string, targetManagerId: string): Promise<boolean> {
  if (!userId || !targetManagerId) return false;
  if (String(userId) === String(targetManagerId)) return true;

  const visited = new Set<string>([String(userId)]);
  let currentId: string | null = String(targetManagerId);

  while (currentId) {
    if (visited.has(currentId)) {
      return true;
    }
    visited.add(currentId);

    const user: any = await User.findById(currentId).select("reportingManagerId").lean();
    if (!user || !user.reportingManagerId) {
      break;
    }
    currentId = String(user.reportingManagerId);
  }

  return false;
}

/**
 * Checks whether requestUser is authorized to view attendance records for targetUserId.
 */
export async function canViewAttendance(requestUser: any, targetUserId: string): Promise<boolean> {
  const currentUserId = String(requestUser._id || requestUser.id);
  const targetId = String(targetUserId);

  if (currentUserId === targetId) return true;
  if (requestUser.role === "SUPER_ADMIN") return true;

  const targetUser = await User.findById(targetId).select("organizationId departmentId teamId").lean();
  if (!targetUser) return false;

  const requestOrgId = requestUser.organizationId ? String(requestUser.organizationId) : null;
  const targetOrgId = targetUser.organizationId ? String(targetUser.organizationId) : null;

  if (requestOrgId && targetOrgId && requestOrgId !== targetOrgId) {
    return false;
  }

  if (requestUser.role === "ADMIN") {
    return true;
  }

  if (requestUser.role === "MANAGER" || requestUser.role === "TEAM_LEADER") {
    const scope = await getManagementScope(requestUser);
    return scope.scopedUserIds.includes(targetId);
  }

  return false;
}

/**
 * Checks whether requestUser has administrative authority to correct attendance for targetUserId.
 */
export async function canCorrectAttendance(requestUser: any, targetUserId: string): Promise<boolean> {
  if (requestUser.role === "SUPER_ADMIN") return true;
  if (requestUser.role !== "ADMIN" && requestUser.role !== "HR") return false;

  const targetUser = await User.findById(targetUserId).select("organizationId").lean();
  if (!targetUser) return false;

  const requestOrgId = requestUser.organizationId ? String(requestUser.organizationId) : null;
  const targetOrgId = targetUser.organizationId ? String(targetUser.organizationId) : null;

  return Boolean(requestOrgId && targetOrgId && requestOrgId === targetOrgId);
}

