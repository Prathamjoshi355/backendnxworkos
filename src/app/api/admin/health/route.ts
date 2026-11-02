import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getSystemHealth } from "../../../../services/systemHealthService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "System Health requires Admin or Super Admin permission", 403);
    }

    const data = await getSystemHealth({
      userRole: user.role,
      organizationId: user.organizationId ? String(user.organizationId) : null,
    });

    return success(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load System Health";
    return error("SYSTEM_HEALTH_FAILED", message, 500);
  }
}
