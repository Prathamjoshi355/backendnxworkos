import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import * as leadQuotaService from "../../../../services/leadQuotaService";
import { success, error } from "../../../../utils/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Only Super Admin and Admin can modify Assignment & Quotas", 403);
  }

  const { id } = await context.params;
  const body = await request.json();
  const updated = await leadQuotaService.updateQuotaRule(id, String(user.organizationId), body);
  if (!updated) return error("NOT_FOUND", "Quota rule not found", 404);

  return success({ quota: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Only Super Admin and Admin can delete Assignment & Quotas", 403);
  }

  const { id } = await context.params;
  await leadQuotaService.deleteQuotaRule(id, String(user.organizationId));
  return success({ message: "Quota rule deleted successfully" });
}
