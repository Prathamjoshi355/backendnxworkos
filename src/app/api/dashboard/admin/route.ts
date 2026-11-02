import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getDashboard } from "../../../../services/dashboardService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) return error("FORBIDDEN", "Forbidden", 403);

    const url = new URL(request.url);
    const range = url.searchParams.get("range") || url.searchParams.get("dateRange") || "this_month";
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const teamId = url.searchParams.get("teamId") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;

    const dashboard = await getDashboard(user, {
      roleOverride: user.role === "SUPER_ADMIN" ? "ADMIN" : user.role,
      period: range,
      departmentId,
      teamId,
      startDate,
      endDate,
    });

    return success({
      ...dashboard,
      // Backwards-compatibility aliases for existing admin clients
      metrics: {
        totalEmployees: dashboard.workforce?.total ?? 0,
        totalInterns: 0,
        activeUsers: (dashboard.workforce?.online ?? 0) + (dashboard.workforce?.onBreak ?? 0),
        onlineUsers: dashboard.workforce?.online ?? 0,
        onBreak: dashboard.workforce?.onBreak ?? 0,
        lateToday: dashboard.workforce?.late ?? 0,
        overdueTasks: dashboard.taskOperations?.overdue ?? 0,
      },
      departmentSummary: dashboard.overview?.departmentBreakdown || [],
      teamSummary: [],
      recentActivity: [],
    });
  } catch (err: any) {
    return error("ADMIN_DASHBOARD_FAILED", err.message || "Failed to load admin dashboard", 500);
  }
}
