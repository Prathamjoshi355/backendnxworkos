import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getAdminReports } from "../../../../services/adminService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);

    const reports = await getAdminReports(user);
    return success(reports);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load admin reports";
    return error("ADMIN_REPORTS_FAILED", message, 500);
  }
}
