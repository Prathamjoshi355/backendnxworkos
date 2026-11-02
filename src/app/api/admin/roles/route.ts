import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { Role } from "../../../../types/roles";
import { success, error } from "../../../../utils/response";

export const CANONICAL_ROLE_PERMISSIONS: Record<string, string[]> = {
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
    "audit.view",
    "security.view",
    "health.view",
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
    "audit.view",
    "security.view",
    "health.view",
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
  DEVELOPER: ["task.view", "attendance.view", "notification.view"],
  DESIGNER: ["task.view", "attendance.view", "notification.view"],
  MARKETING: ["task.view", "attendance.view", "notification.view", "lead.view.self"],
  HR: [
    "user.view",
    "employee.view.team",
    "attendance.view",
    "compensation.view",
    "compensation.manage",
    "report.view",
    "notification.view",
  ],
};

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const allRoles = Object.values(Role);

    return success({
      roles: allRoles,
      rolePermissions: CANONICAL_ROLE_PERMISSIONS,
      isSuperAdmin: user.role === "SUPER_ADMIN",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load roles";
    return error("ROLES_FAILED", message, 500);
  }
}
