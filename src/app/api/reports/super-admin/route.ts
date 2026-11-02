import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getReportsCenter } from "../../../../services/superAdminService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);

    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId") || user.organizationId || null;
    const reports = await getReportsCenter(organizationId ? String(organizationId) : null);
    return success(reports);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load reports";
    return error("SUPER_ADMIN_REPORTS_FAILED", message, 500);
  }
}
