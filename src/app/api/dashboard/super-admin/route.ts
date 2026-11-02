import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getDashboard } from "../../../../services/dashboardService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);

    const url = new URL(request.url);
    const range = url.searchParams.get("range") || url.searchParams.get("dateRange") || "this_month";
    const organizationId = url.searchParams.get("organizationId") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;

    const dashboard = await getDashboard(user, {
      roleOverride: "SUPER_ADMIN",
      period: range,
      organizationId,
      startDate,
      endDate,
    });

    return success({
      ...dashboard,
      // Backwards-compatibility aliases for existing super admin clients
      metrics: {
        totalOrganizations: dashboard.organizationComparison?.length ?? 0,
        totalEmployees: (dashboard.overview?.kpis?.totalEmployees as any)?.current ?? 0,
        activeUsers: (dashboard.overview?.kpis?.activeEmployees as any)?.current ?? 0,
      },
      departmentSummary: dashboard.overview?.departmentBreakdown || [],
      teamSummary: [],
      recentActivity: [],
    });
  } catch (err: any) {
    return error("SUPER_ADMIN_DASHBOARD_FAILED", err.message || "Failed to load super admin dashboard", 500);
  }
}
