import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { UserUpdateSchema } from "../../../../validators/user";
import * as userService from "../../../../services/userService";
import { recordAuditLog } from "../../../../services/auditLogService";
import { success, error } from "../../../../utils/response";

function isSameUser(authUser: any, id: string) {
  return authUser && String(authUser._id) === String(id);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const authUser = await getUserFromRequest(request);
  if (!authUser) return error("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await context.params;
  const u = await userService.getUserById(id);
  if (!u) return error("NOT_FOUND", "User not found", 404);

  // Super Admin can access any user
  if (authUser.role === "SUPER_ADMIN") {
    return success({ user: u });
  }

  // Organization isolation
  if (u.organizationId && String(u.organizationId) !== String(authUser.organizationId)) {
    return error("FORBIDDEN", "Forbidden - user belongs to another organization", 403);
  }

  // Self or Admin
  if (isSameUser(authUser, id) || authUser.role === "ADMIN") {
    return success({ user: u });
  }

  // Manager or Team Leader scope check
  if (authUser.role === "MANAGER" || authUser.role === "TEAM_LEADER") {
    const { getManagementScope } = await import("../../../../utils/scopeHelper");
    const scope = await getManagementScope(authUser);
    if (!scope.scopedUserIds.includes(String(id))) {
      return error("FORBIDDEN", "Forbidden - user outside management scope", 403);
    }
    return success({ user: u });
  }

  return error("FORBIDDEN", "Forbidden", 403);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const authUser = await getUserFromRequest(request);
  if (!authUser) return error("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await context.params;
  const body = await request.json();
  const parsed = UserUpdateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

  // if same user, restrict sensitive employment/admin fields
  if (isSameUser(authUser, id)) {
    const forbidden = ["role", "employmentType", "organizationId", "departmentId", "teamId", "status", "employmentStatus", "employeeId", "joiningDate", "reportingManagerId", "permissions", "deniedPermissions", "isSuperAdmin"];
    for (const f of forbidden) delete (parsed.data as any)[f];
  } else {
    if (!requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  }
  const existing = await userService.getUserById(id);
  if (!existing) return error("NOT_FOUND", "User not found", 404);

  // Organization isolation for Admin
  if (authUser.role !== "SUPER_ADMIN") {
    if (existing.organizationId && String(existing.organizationId) !== String(authUser.organizationId)) {
      return error("FORBIDDEN", "Forbidden - user belongs to another organization", 403);
    }
    // Prevent non-super-admins from changing organizationId or injecting permissions
    delete (parsed.data as any).organizationId;
    delete (parsed.data as any).permissions;
    delete (parsed.data as any).deniedPermissions;
    delete (parsed.data as any).isSuperAdmin;
  }

  if (authUser.role === "ADMIN" && existing.role === "SUPER_ADMIN") return error("FORBIDDEN", "ADMIN cannot manage SUPER_ADMIN", 403);
  if ((parsed.data as any).role) {
    try {
      const { validateRoleAssignment } = await import("../../../../utils/divisionAuth");
      validateRoleAssignment(authUser, (parsed.data as any).role, { targetOrgId: existing.organizationId });
    } catch (err: any) {
      return error("FORBIDDEN", err.message || "Unauthorized role assignment", 403);
    }
  }

  try {
    const updated = await userService.updateUser(id, parsed.data);
    
    // Determine specific audit action
    let action = "USER_UPDATED";
    let summary = `Updated user ${updated?.fullName || id}`;

    const oldStatus = existing.status || existing.employmentStatus || "ACTIVE";
    const newStatus = parsed.data.status || parsed.data.employmentStatus;

    if (newStatus && newStatus !== oldStatus) {
      action = "EMPLOYEE_STATUS_CHANGED";
      summary = `Changed status of ${updated?.fullName || id} from ${oldStatus} to ${newStatus}`;
    } else if (parsed.data.role && parsed.data.role !== existing.role) {
      if (parsed.data.role === "MANAGER") {
        action = "ROLE_PROMOTED_MANAGER";
        summary = `Promoted ${updated?.fullName || id} to Manager`;
      } else if (parsed.data.role === "TEAM_LEADER") {
        action = "ROLE_PROMOTED_TEAM_LEAD";
        summary = `Promoted ${updated?.fullName || id} to Team Lead`;
      } else if (parsed.data.role === "EMPLOYEE") {
        action = "ROLE_DEMOTED_EMPLOYEE";
        summary = `Demoted ${updated?.fullName || id} to Employee`;
      } else {
        action = "ROLE_CHANGED";
        summary = `Changed role of ${updated?.fullName || id} to ${parsed.data.role}`;
      }
    } else if (parsed.data.teamId && String(parsed.data.teamId) !== String(existing.teamId)) {
      action = "EMPLOYEE_TEAM_TRANSFERRED";
      summary = `Transferred ${updated?.fullName || id} to new team`;
    } else if (parsed.data.departmentId && String(parsed.data.departmentId) !== String(existing.departmentId)) {
      action = "EMPLOYEE_DEPARTMENT_CHANGED";
      summary = `Transferred ${updated?.fullName || id} to new department`;
    }

    await recordAuditLog({
      organizationId: String(updated?.organizationId || authUser.organizationId || ""),
      actorId: String(authUser._id),
      actorRole: authUser.role,
      action,
      entityType: "USER",
      entityId: id,
      summary,
      metadata: {
        changedBy: String(authUser._id),
        targetUser: String(id),
        previousRole: existing.role,
        newRole: parsed.data.role || existing.role,
        previousStatus: oldStatus,
        newStatus: newStatus || oldStatus,
        previousTeam: existing.teamId || null,
        newTeam: parsed.data.teamId || existing.teamId || null,
        previousDepartment: existing.departmentId || null,
        newDepartment: parsed.data.departmentId || existing.departmentId || null,
        timestamp: new Date().toISOString(),
        organizationId: String(updated?.organizationId || authUser.organizationId || ""),
      },
    });

    // Send notifications on significant lifecycle events
    try {
      const { createNotification } = await import("../../../../services/notificationService");
      if (action === "EMPLOYEE_TEAM_TRANSFERRED") {
        await createNotification({
          recipientId: String(id),
          organizationId: String(updated?.organizationId || ""),
          title: "Team Assignment Updated",
          message: "You have been reassigned to a new team in the organization hierarchy.",
          type: "GENERAL",
          priority: "NORMAL",
        });
      } else if (action === "EMPLOYEE_DEPARTMENT_CHANGED") {
        await createNotification({
          recipientId: String(id),
          organizationId: String(updated?.organizationId || ""),
          title: "Department Assignment Updated",
          message: "You have been reassigned to a new department in the organization hierarchy.",
          type: "GENERAL",
          priority: "NORMAL",
        });
      } else if (action === "ROLE_PROMOTED_TEAM_LEAD") {
        await createNotification({
          recipientId: String(id),
          organizationId: String(updated?.organizationId || ""),
          title: "Promoted to Team Lead",
          message: "You have been assigned Team Lead authority for your designated team.",
          type: "ANNOUNCEMENT",
          priority: "HIGH",
        });
      } else if (action === "ROLE_PROMOTED_MANAGER") {
        await createNotification({
          recipientId: String(id),
          organizationId: String(updated?.organizationId || ""),
          title: "Promoted to Manager",
          message: "You have been assigned Manager authority over your designated teams.",
          type: "ANNOUNCEMENT",
          priority: "HIGH",
        });
      }
    } catch (_) {}

    return success({ user: updated });
  } catch (err: any) {
    if (err.message === "EMAIL_EXISTS") return error("EMAIL_EXISTS", "Email already exists", 409);
    if (err.message === "ORG_NOT_FOUND") return error("ORG_NOT_FOUND", "Organization not found", 404);
    if (err.message === "DEPT_NOT_FOUND") return error("DEPT_NOT_FOUND", "Department not found", 404);
    return error("INTERNAL_ERROR", "Unable to update user", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const authUser = await getUserFromRequest(request);
  if (!authUser || !requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  const { id } = await context.params;
  const existing = await userService.getUserById(id);
  if (!existing) return error("NOT_FOUND", "User not found", 404);

  // Cross-tenant protection for ADMIN
  if (authUser.role !== "SUPER_ADMIN") {
    if (existing.organizationId && String(existing.organizationId) !== String(authUser.organizationId)) {
      await recordAuditLog({
        organizationId: String(authUser.organizationId || ""),
        actorId: String(authUser._id),
        actorRole: authUser.role,
        action: "SECURITY_VIOLATION_CROSS_TENANT_DELETE",
        entityType: "USER",
        entityId: id,
        summary: `Cross-tenant deletion attempt blocked for user ${id}`,
      });
      return error("FORBIDDEN", "Forbidden - user belongs to another organization", 403);
    }
    if (existing.role === "SUPER_ADMIN") {
      await recordAuditLog({
        organizationId: String(authUser.organizationId || ""),
        actorId: String(authUser._id),
        actorRole: authUser.role,
        action: "SECURITY_VIOLATION_ROLE_ESCALATION",
        entityType: "USER",
        entityId: id,
        summary: `Unauthorized attempt to delete SUPER_ADMIN user ${id}`,
      });
      return error("FORBIDDEN", "ADMIN cannot manage SUPER_ADMIN", 403);
    }
  }

  const deleted = await userService.softDeleteUser(id);
  await recordAuditLog({
    organizationId: String(deleted?.organizationId || authUser.organizationId || ""),
    actorId: String(authUser._id),
    actorRole: authUser.role,
    action: "USER_DEACTIVATED",
    entityType: "USER",
    entityId: id,
    summary: `Deactivated user ${deleted?.fullName || id}`,
  });
  return success({ user: deleted });
}
