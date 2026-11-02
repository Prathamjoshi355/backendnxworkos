import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole, getEffectivePermissions } from "../../../../../middleware/auth";
import User from "../../../../../models/User";
import Department from "../../../../../models/Department";
import Team from "../../../../../models/Team";
import { recordAuditLog } from "../../../../../services/auditLogService";
import { success, error } from "../../../../../utils/response";

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [
    "organization.view",
    "organization.manage",
    "department.view",
    "department.manage",
    "team.view",
    "team.view.managed",
    "team.manage",
    "team.assign",
    "teamlead.manage",
    "manager.manage.teams",
    "user.view",
    "user.create",
    "user.edit",
    "user.delete",
    "employee.view.team",
    "employee.manage.team",
    "attendance.view",
    "task.view",
    "task.manage",
    "task.assign.team",
    "task.assign.employee",
    "performance.view",
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
    "user.view",
    "user.create",
    "user.edit",
    "department.view",
    "department.manage",
    "team.view",
    "team.view.managed",
    "team.manage",
    "team.assign",
    "teamlead.manage",
    "manager.manage.teams",
    "employee.view.team",
    "employee.manage.team",
    "attendance.view",
    "task.view",
    "task.manage",
    "task.assign.team",
    "task.assign.employee",
    "performance.view",
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
  MANAGER: [
    "task.view",
    "task.manage",
    "task.assign.team",
    "task.assign.employee",
    "team.view.managed",
    "teamlead.manage",
    "employee.view.team",
    "employee.manage.team",
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
    "task.view",
    "task.manage",
    "task.assign.employee",
    "team.view.self",
    "employee.view.team",
    "attendance.view",
    "leave.review",
    "lead.view.self",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  SALES_EXECUTIVE: ["lead.view.self", "lead.call", "lead.followup", "task.view", "attendance.view"],
  EMPLOYEE: ["task.view", "attendance.view", "notification.view"],
  INTERN: ["task.view", "attendance.view", "notification.view"],
};

function resolveAccessScope(user: any): string {
  if (user?.role === "SUPER_ADMIN") return "ORGANIZATION";
  if (user?.role === "ADMIN") return user?.departmentId ? "DEPARTMENT" : "ORGANIZATION";
  if (user?.teamId) return "TEAM";
  if (user?.departmentId) return "DEPARTMENT";
  return "SELF";
}

function serializeUser(user: any, department?: any, team?: any) {
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const deniedPermissions = Array.isArray(user.deniedPermissions) ? user.deniedPermissions : [];
  const defaultRolePermissions = DEFAULT_ROLE_PERMISSIONS[user.role] ?? [];
  const effectivePermissions = getEffectivePermissions(user);
  return {
    ...user,
    passwordHash: undefined,
    permissions,
    deniedPermissions,
    defaultRolePermissions,
    effectivePermissions,
    accessScope: user.accessScope || user.scope || resolveAccessScope(user),
    scope: user.accessScope || user.scope || resolveAccessScope(user),
    departmentName: department?.name ?? null,
    teamName: team?.name ?? null,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const authUser = await getUserFromRequest(request);
  if (!authUser || !requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Forbidden", 403);
  }

  const { id } = await context.params;
  const user = await User.findById(id).lean();
  if (!user) return error("NOT_FOUND", "User not found", 404);

  if (authUser.role !== "SUPER_ADMIN") {
    if (user.organizationId && String(user.organizationId) !== String(authUser.organizationId)) {
      return error("FORBIDDEN", "Forbidden - user belongs to another organization", 403);
    }
    if (user.role === "SUPER_ADMIN") {
      return error("FORBIDDEN", "ADMIN cannot manage SUPER_ADMIN", 403);
    }
  }

  const department = user.departmentId ? await Department.findById(user.departmentId).select("name").lean() : null;
  const team = user.teamId ? await Team.findById(user.teamId).select("name").lean() : null;

  return success({
    user: serializeUser(user, department, team),
    defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS[user.role] ?? [],
    effectivePermissions: getEffectivePermissions(user),
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const authUser = await getUserFromRequest(request);
  if (!authUser || !requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Forbidden", 403);
  }

  const { id } = await context.params;
  const body = await request.json();
  const target = await User.findById(id).lean();
  if (!target) return error("NOT_FOUND", "User not found", 404);

  if (authUser.role !== "SUPER_ADMIN") {
    if (target.organizationId && String(target.organizationId) !== String(authUser.organizationId)) {
      return error("FORBIDDEN", "Forbidden - user belongs to another organization", 403);
    }
    if (target.role === "SUPER_ADMIN") {
      return error("FORBIDDEN", "ADMIN cannot manage SUPER_ADMIN", 403);
    }
  }
  const update: any = {};

  if (body.permissions !== undefined) {
    update.permissions = Array.isArray(body.permissions) ? body.permissions : [];
  }

  if (body.deniedPermissions !== undefined) {
    update.deniedPermissions = Array.isArray(body.deniedPermissions) ? body.deniedPermissions : [];
  }

  if (body.accessScope !== undefined) {
    update.accessScope = String(body.accessScope);
  }

  if (Object.keys(update).length === 0) {
    return error("VALIDATION_ERROR", "No permission update provided", 422);
  }

  const updated = await User.findByIdAndUpdate(id, update, { new: true }).lean();
  if (!updated) return error("NOT_FOUND", "User not found", 404);
  await recordAuditLog({
    organizationId: String(updated.organizationId || authUser.organizationId || ""),
    actorId: String(authUser._id),
    actorRole: authUser.role,
    action: "PERMISSION_CHANGED",
    entityType: "USER",
    entityId: id,
    summary: `Updated permissions for ${updated.fullName}`,
    metadata: update,
  });

  const department = updated.departmentId ? await Department.findById(updated.departmentId).select("name").lean() : null;
  const team = updated.teamId ? await Team.findById(updated.teamId).select("name").lean() : null;

  return success({
    user: serializeUser(updated, department, team),
    defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS[updated.role] ?? [],
    effectivePermissions: getEffectivePermissions(updated),
  });
}
