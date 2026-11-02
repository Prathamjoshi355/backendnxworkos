import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { AnalyticsService, resolveDateBounds } from "../../../../services/analyticsService";
import { getManagementScope } from "../../../../utils/scopeHelper";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const range = url.searchParams.get("range") || url.searchParams.get("dateRange") || "TODAY";
    const bounds = resolveDateBounds(range, url.searchParams.get("startDate") || undefined, url.searchParams.get("endDate") || undefined);

    const filter: Record<string, any> = {};

    if (user.role === "SUPER_ADMIN") {
      if (url.searchParams.get("organizationId")) filter.organizationId = url.searchParams.get("organizationId");
    } else if (user.role === "ADMIN") {
      filter.organizationId = user.organizationId;
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      filter.organizationId = user.organizationId;
      const scope = await getManagementScope(user);
      filter.userId = { $in: scope.scopedUserIds };
    } else {
      filter.userId = String(user._id);
    }

    const eodMetrics = await AnalyticsService.getEodMetrics(filter, bounds);
    return success({ dateRange: bounds, blockers: eodMetrics.unresolvedBlockers });
  } catch (err: any) {
    return error("GET_BLOCKER_ANALYTICS_FAILED", err.message || "Failed to load blocker analytics", 500);
  }
}
