import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as hrService from "../../../../../services/hrService";
import * as userService from "../../../../../services/userService";
import { recordAuditLog } from "../../../../../services/auditLogService";
import { emitEmployeeUpdated } from "../../../../../lib/socketEmitters";
import { success, error } from "../../../../../utils/response";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const { id } = await context.params;
    const profile = await hrService.getEmployeeHrProfile(user, id);
    return success(profile);
  } catch (err: any) {
    console.error("GET /api/hr/employees/[id] error:", err);
    if (err.message === "EMPLOYEE_NOT_FOUND") return error("NOT_FOUND", "Employee not found", 404);
    if (err.message === "FORBIDDEN_ORGANIZATION_ACCESS") return error("FORBIDDEN", "Forbidden - cross-organization access", 403);
    return error("FAILED", err.message || "Failed to load employee profile", 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const { id } = await context.params;
    const isSelf = String(user._id || user.id) === String(id);
    const isPrivileged = hrService.isHrOrAdmin(user);

    if (!isPrivileged && !isSelf) {
      return error("FORBIDDEN", "Forbidden - cannot edit another user's HR profile", 403);
    }

    const body = await request.json();

    // If self (and not HR/Admin), restrict to personal details only
    if (isSelf && !isPrivileged) {
      const allowedSelfFields = [
        "phone",
        "personalEmail",
        "alternatePhone",
        "currentAddress",
        "permanentAddress",
        "emergencyContactName",
        "emergencyContactRelation",
        "emergencyContactPhone",
        "emergencyContactAlternatePhone",
        "profilePhoto",
      ];
      for (const k of Object.keys(body)) {
        if (!allowedSelfFields.includes(k)) delete body[k];
      }
    }

    // Validate reporting manager if changed by HR
    if (body.reportingManagerId && isPrivileged) {
      await hrService.validateManagerAssignment(id, body.reportingManagerId, String(user.organizationId || ""));
    }

    const updated = await userService.updateUser(id, body);

    await recordAuditLog({
      organizationId: String(updated?.organizationId || user.organizationId || ""),
      actorId: String(user._id || user.id),
      actorRole: user.role,
      action: "HR_PROFILE_UPDATED",
      entityType: "USER",
      entityId: id,
      summary: `Updated HR profile details for ${updated?.fullName || id}`,
      metadata: { fields: Object.keys(body) },
    });

    emitEmployeeUpdated(updated, updated?.organizationId || user.organizationId || undefined);

    return success({ employee: updated });
  } catch (err: any) {
    console.error("PATCH /api/hr/employees/[id] error:", err);
    if (err.message === "USER_NOT_FOUND") return error("NOT_FOUND", "User not found", 404);
    if (err.message === "CANNOT_MANAGE_SELF") return error("CANNOT_MANAGE_SELF", "Employee cannot report to self", 422);
    if (err.message === "CIRCULAR_REPORTING_DETECTED") return error("CIRCULAR_REPORTING", "Circular reporting hierarchy detected", 422);
    if (err.message === "MANAGER_CROSS_ORG_FORBIDDEN") return error("FORBIDDEN", "Manager belongs to another organization", 403);
    return error("FAILED", err.message || "Failed to update employee", 500);
  }
}
