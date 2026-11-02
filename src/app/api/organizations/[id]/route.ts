import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import * as orgService from "../../../../services/organizationService";
import { OrganizationUpdateSchema } from "../../../../validators/organization";
import { recordAuditLog } from "../../../../services/auditLogService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Forbidden", 403);
  }

  const { id } = await context.params;

  // Organization isolation for Admin
  if (user.role === "ADMIN" && String(user.organizationId) !== String(id)) {
    return error("FORBIDDEN", "Admin cannot access another organization's details", 403);
  }

  const org = await orgService.getOrganizationById(id);
  if (!org) return error("NOT_FOUND", "Organization not found", 404);
  return success({ organization: org });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);

  const { id } = await context.params;

  // Organization isolation for Admin
  if (user.role === "ADMIN" && String(user.organizationId) !== String(id)) {
    return error("FORBIDDEN", "Admin cannot modify another organization", 403);
  }

  const body = await request.json();

  // Status toggle check - Admins cannot deactivate their own organization; only Super Admin can
  if (body.status !== undefined && user.role !== "SUPER_ADMIN") {
    return error("FORBIDDEN", "Only Super Admin can change organization status", 403);
  }

  const parsed = OrganizationUpdateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

  const updated = await orgService.updateOrganization(id, parsed.data);
  if (!updated) return error("NOT_FOUND", "Organization not found", 404);

  const isStatusChange = body.status !== undefined;
  await recordAuditLog({
    organizationId: id,
    actorId: String(user._id),
    actorRole: user.role,
    action: isStatusChange ? "ORGANIZATION_STATUS_CHANGED" : "ORGANIZATION_UPDATED",
    entityType: "ORGANIZATION",
    entityId: id,
    summary: isStatusChange
      ? `Changed organization ${updated.name} status to ${body.status}`
      : `Updated organization ${updated.name}`,
    metadata: parsed.data,
  });

  return success({ organization: updated });
}
