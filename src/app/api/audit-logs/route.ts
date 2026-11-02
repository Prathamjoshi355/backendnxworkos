import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import * as auditLogService from "../../../services/auditLogService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Audit logs require Admin or Super Admin permission", 403);
    }

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "20");
    const action = url.searchParams.get("action") || undefined;
    const actorId = url.searchParams.get("actorId") || undefined;
    const entityType = url.searchParams.get("entityType") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const reqOrgId = url.searchParams.get("organizationId") || undefined;

    // Strict organization scoping
    if (user.role === "ADMIN" && reqOrgId && reqOrgId !== String(user.organizationId)) {
      return error("FORBIDDEN", "Admin cannot access another organization's audit logs", 403);
    }

    const filter: Record<string, unknown> = {};
    if (user.role === "ADMIN") {
      filter.organizationId = user.organizationId;
    } else if (reqOrgId) {
      filter.organizationId = reqOrgId;
    }

    if (action) filter.action = action;
    if (actorId) filter.actorId = actorId;
    if (entityType) filter.entityType = entityType;

    const result = await auditLogService.listAuditLogs(filter, {
      skip: (page - 1) * limit,
      limit,
      search,
      startDate,
      endDate,
    });

    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load audit logs";
    return error("AUDIT_LOG_LIST_FAILED", message, 500);
  }
}
