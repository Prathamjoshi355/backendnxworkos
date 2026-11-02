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
      if (url.searchParams.get("teamId")) filter.teamId = url.searchParams.get("teamId");
      if (url.searchParams.get("departmentId")) filter.departmentId = url.searchParams.get("departmentId");
      if (url.searchParams.get("userId")) filter.assignedTo = url.searchParams.get("userId");
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      filter.organizationId = user.organizationId;
      const scope = await getManagementScope(user);
      if (url.searchParams.get("userId")) {
        const target = url.searchParams.get("userId")!;
        if (!scope.scopedUserIds.includes(target)) return error("FORBIDDEN", "Forbidden", 403);
        filter.assignedTo = target;
      } else {
        filter.assignedTo = { $in: scope.scopedUserIds };
      }
    } else {
      filter.assignedTo = String(user._id);
    }

    const metrics = await AnalyticsService.getTaskMetrics(filter, bounds);
    return success({ dateRange: bounds, metrics });
  } catch (err: any) {
    return error("GET_TASK_ANALYTICS_FAILED", err.message || "Failed to load task analytics", 500);
  }
}
