import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { updateDepartment, setDepartmentStatus } from "../../../../../services/departmentService";
import { recordAuditLog } from "../../../../../services/auditLogService";
import { success, error } from "../../../../../utils/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  const body = await request.json();
  const status = String(body.status || "").toUpperCase();
  if (!["ACTIVE", "INACTIVE"].includes(status)) return error("VALIDATION_ERROR", "Invalid department status", 422);

  try {
    const updated = await setDepartmentStatus((await context.params).id, status);
    if (!updated) return error("NOT_FOUND", "Department not found", 404);
    await recordAuditLog({
      organizationId: String(updated.organizationId || user.organizationId || ""),
      actorId: String(user._id),
      actorRole: user.role,
      action: "DEPARTMENT_UPDATED",
      entityType: "DEPARTMENT",
      entityId: (await context.params).id,
      summary: `Updated department status to ${status}`,
    });
    return success({ department: updated });
  } catch (err: any) {
    if (err.message.startsWith("DEPARTMENT_HAS_ACTIVE")) {
      return error("PRECONDITION_FAILED", err.message, 412);
    }
    return error("FAILED", err.message || "Failed to update department status", 500);
  }
}
