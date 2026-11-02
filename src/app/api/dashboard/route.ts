import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import { getDashboard } from "../../../services/dashboardService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const period = url.searchParams.get("period") || url.searchParams.get("dateRange") || url.searchParams.get("range") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const teamId = url.searchParams.get("teamId") || undefined;
    const projectId = url.searchParams.get("projectId") || undefined;
    const organizationId = url.searchParams.get("organizationId") || undefined;

    // Security validation: Employee cannot query cross-organization data
    if (user.role === "EMPLOYEE" || user.role === "INTERN") {
      if (organizationId && String(organizationId) !== String(user.organizationId)) {
        return error("FORBIDDEN", "Employees cannot query external organization data", 403);
      }
    }

    const dashboard = await getDashboard(user, {
      period,
      startDate,
      endDate,
      departmentId,
      teamId,
      projectId,
      organizationId,
    });

    return success(dashboard);
  } catch (err: any) {
    return error("GET_DASHBOARD_FAILED", err.message || "Failed to generate dashboard", 500);
  }
}
