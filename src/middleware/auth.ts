import { verifyToken } from "../services/authService";
import User from "../models/User";
import { connectToDatabase } from "../config/database";

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [
    "organization.view",
    "organization.manage",
    "hierarchy.manage",
    "department.view",
    "department.manage",
    "team.view",
    "team.view.managed",
    "team.view.own",
    "team.manage",
    "team.manage.managed",
    "team.assign",
    "teamlead.manage",
    "manager.manage.teams",
    "user.view",
    "user.create",
    "user.edit",
    "user.delete",
    "employee.manage",
    "employee.view.team",
    "employee.view.managed",
    "employee.manage.team",
    "attendance.view",
    "task.view",
    "task.view.managed",
    "task.view.team",
    "task.manage",
    "task.assign.any.organization",
    "task.assign.team",
    "task.assign.managed",
    "task.assign.employee",
    "performance.view",
    "performance.view.managed",
    "performance.view.team",
    "compensation.view",
    "compensation.manage",
    "lead.view.self",
    "lead.create",
    "lead.edit",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "report.view",
    "report.export",
    "notification.view",
  ],
  ADMIN: [
    "organization.manage",
    "hierarchy.manage",
    "user.view",
    "user.create",
    "user.edit",
    "employee.manage",
    "department.view",
    "department.manage",
    "team.view",
    "team.view.managed",
    "team.view.own",
    "team.manage",
    "team.manage.managed",
    "team.assign",
    "teamlead.manage",
    "manager.manage.teams",
    "employee.view.team",
    "employee.view.managed",
    "employee.manage.team",
    "attendance.view",
    "task.view",
    "task.view.managed",
    "task.view.team",
    "task.manage",
    "task.assign.any.organization",
    "task.assign.team",
    "task.assign.managed",
    "task.assign.employee",
    "performance.view",
    "performance.view.managed",
    "performance.view.team",
    "compensation.view",
    "compensation.manage",
    "lead.view.self",
    "lead.create",
    "lead.edit",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  DIVISION_ADMIN: [
    "department.view",
    "department.manage",
    "team.view",
    "team.view.managed",
    "team.view.own",
    "team.manage",
    "team.manage.managed",
    "team.assign",
    "teamlead.manage",
    "manager.manage.teams",
    "user.view",
    "user.create",
    "user.edit",
    "employee.manage",
    "employee.view.team",
    "employee.view.managed",
    "employee.manage.team",
    "attendance.view",
    "task.view",
    "task.view.managed",
    "task.view.team",
    "task.manage",
    "task.assign.team",
    "task.assign.managed",
    "task.assign.employee",
    "performance.view",
    "performance.view.managed",
    "performance.view.team",
    "lead.view.self",
    "lead.create",
    "lead.edit",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  MANAGER: [
    "team.view.managed",
    "team.manage.managed",
    "teamlead.manage",
    "employee.view.managed",
    "employee.view.team",
    "employee.manage.team",
    "task.view",
    "task.view.managed",
    "task.manage",
    "task.assign.managed",
    "task.assign.team",
    "task.assign.employee",
    "performance.view.managed",
    "attendance.view",
    "leave.review",
    "report.view",
    "lead.view.self",
    "lead.create",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  TEAM_LEADER: [
    "team.view.own",
    "team.view.self",
    "employee.view.team",
    "task.view",
    "task.view.team",
    "task.manage",
    "task.assign.team",
    "task.assign.employee",
    "performance.view.team",
    "attendance.view",
    "leave.review",
    "lead.view.self",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  SALES_EXECUTIVE: [
    "lead.view.self",
    "lead.call",
    "lead.followup",
    "task.view",
    "attendance.view",
  ],
  EMPLOYEE: [
    "task.view",
    "attendance.view",
    "notification.view",
  ],
  INTERN: [
    "task.view",
    "attendance.view",
    "notification.view",
  ],
};

export function getEffectivePermissions(user: any) {
  const granted = new Set<string>(Array.isArray(user?.permissions) ? user.permissions : []);
  const denied = new Set<string>(Array.isArray(user?.deniedPermissions) ? user.deniedPermissions : []);
  const defaultPermissions = DEFAULT_ROLE_PERMISSIONS[user?.role] ?? [];

  for (const permission of defaultPermissions) {
    granted.add(permission);
  }

  const effective = [...granted].filter((permission) => !denied.has(permission));
  return [...new Set(effective)].sort();
}

export class PasswordChangeRequiredError extends Error {
  code: string;
  status: number;
  constructor(message = "Mandatory password change required before accessing platform.") {
    super(message);
    this.name = "PasswordChangeRequiredError";
    this.code = "PASSWORD_CHANGE_REQUIRED";
    this.status = 403;
  }
}

export async function getUserFromRequest(
  request: Request,
  options?: { allowPendingPasswordChange?: boolean }
) {
  await connectToDatabase();
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!token) return null;
  const payload: any = verifyToken(token);
  if (!payload || !payload.sub) return null;
  const user = await User.findById(payload.sub).lean();
  if (!user) return null;
  if (user.status && ["SUSPENDED", "INACTIVE", "TERMINATED", "DEACTIVATED"].includes(user.status.toUpperCase())) {
    return null;
  }

  // Invalidate tokens issued before password was changed
  if (user.passwordChangedAt) {
    const pwdTime = new Date(user.passwordChangedAt).getTime();
    if (payload.pwdVersion) {
      if (payload.pwdVersion < pwdTime) return null;
    } else if (payload.iat) {
      if (payload.iat * 1000 < pwdTime - 1000) {
        return null;
      }
    }
  }

  // Server-side enforcement of mandatory password change on first login
  if (user.mustChangePassword && !options?.allowPendingPasswordChange) {
    let pathname = "";
    try {
      pathname = new URL(request.url).pathname;
    } catch (_) {
      pathname = "";
    }
    const isExempt =
      pathname.includes("/api/auth/change-password") ||
      pathname.includes("/api/auth/me") ||
      pathname.includes("/api/auth/logout");

    if (!isExempt) {
      throw new PasswordChangeRequiredError();
    }
  }

  return user;
}

export function requireRole(user: any, allowed: string[]) {
  if (!user) return false;
  return allowed.includes(user.role);
}

export function requirePermission(user: any, permission: string) {
  if (!user) return false;

  const effective = getEffectivePermissions(user);
  if (effective.includes(permission)) return true;

  return false;
}

export function hasCompensationPermission(user: any, permission: string) {
  if (!user) return false;

  if (user.role === "SUPER_ADMIN") return true;
  const explicit = user.permissions || [];
  if (Array.isArray(explicit) && explicit.includes(permission)) return true;

  return false;
}

export {
  hasDivisionAccess,
  validateDivisionScope,
  validateRoleAssignment,
  DivisionAuthError,
} from "../utils/divisionAuth";
