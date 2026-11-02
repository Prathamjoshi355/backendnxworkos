import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { AnalyticsService } from "../../../../services/analyticsService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const url = new URL(request.url);
    const range = url.searchParams.get("range") || url.searchParams.get("dateRange") || "TODAY";
    const teamId = url.searchParams.get("teamId") || undefined;

    const dashboard = await AnalyticsService.getTeamLeadDashboard(user, range, teamId);
    return success(dashboard);
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : err.message === "NO_ASSIGNED_TEAM" ? 400 : 500;
    return error("GET_TEAM_DASHBOARD_FAILED", err.message || "Failed to load team dashboard", status);
  }
}
