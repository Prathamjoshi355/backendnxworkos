import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import * as leadQuotaService from "../../../services/leadQuotaService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Only Super Admin and Admin can access Assignment & Quotas", 403);
  }

  const quotas = await leadQuotaService.listQuotaRules(String(user.organizationId));
  return success({ quotas });
}

export async function POST(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Only Super Admin and Admin can manage Assignment & Quotas", 403);
  }

  const body = await request.json();
  if (!body.productId || !body.employeeId || body.maxLeads === undefined) {
    return error("VALIDATION_ERROR", "productId, employeeId, and maxLeads are required", 422);
  }

  try {
    const quota = await leadQuotaService.createQuotaRule({
      organizationId: String(user.organizationId),
      productId: body.productId,
      employeeId: body.employeeId,
      maxLeads: Number(body.maxLeads),
      period: body.period,
      departmentId: body.departmentId,
      teamId: body.teamId,
    });
    return success({ quota });
  } catch (err: any) {
    return error("QUOTA_CREATE_FAILED", err.message || "Failed to create quota rule", 500);
  }
}
