import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import * as deptService from "../../../../services/departmentService";
import { recordAuditLog } from "../../../../services/auditLogService";
import { DepartmentUpdateSchema } from "../../../../validators/department";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await context.params;
  const d = await deptService.getDepartmentById(id);
  if (!d) return error("NOT_FOUND", "Department not found", 404);
  return success({ department: d });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  const { id } = await context.params;
  const existing = await deptService.getDepartmentById(id);
  if (!existing) return error("NOT_FOUND", "Department not found", 404);

  if (user.role !== "SUPER_ADMIN" && String(existing.organizationId) !== String(user.organizationId)) {
    return error("FORBIDDEN", "Forbidden: Cross-tenant department modification denied", 403);
  }

  const body = await request.json();
  if (user.role !== "SUPER_ADMIN") {
    delete body.organizationId;
  }

  const parsed = DepartmentUpdateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);
  try {
    const updated = await deptService.updateDepartment(id, parsed.data);
    if (updated) {
      await recordAuditLog({
        organizationId: String(updated.organizationId || user.organizationId || ""),
        actorId: String(user._id),
        actorRole: user.role,
        action: "DEPARTMENT_UPDATED",
        entityType: "DEPARTMENT",
        entityId: id,
        summary: `Updated department ${updated.name}`,
        metadata: parsed.data,
      });
    }
    return success({ department: updated });
  } catch (err: any) {
    if (err.message === "ORG_NOT_FOUND") return error("ORG_NOT_FOUND", "Organization not found", 404);
    console.error(err);
    return error("INTERNAL_ERROR", "Unable to update department", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  const { id } = await context.params;
  const existing = await deptService.getDepartmentById(id);
  if (!existing) return error("NOT_FOUND", "Department not found", 404);

  if (user.role !== "SUPER_ADMIN" && String(existing.organizationId) !== String(user.organizationId)) {
    return error("FORBIDDEN", "Forbidden: Cross-tenant department deactivation denied", 403);
  }

  const updated = await deptService.updateDepartment(id, { status: "INACTIVE" });
  if (!updated) return error("NOT_FOUND", "Department not found", 404);
  return success({ department: updated });
}
