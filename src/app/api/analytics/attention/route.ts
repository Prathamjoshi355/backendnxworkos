import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { AnalyticsService, resolveDateBounds } from "../../../../services/analyticsService";
import { getManagementScope } from "../../../../utils/scopeHelper";
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
    const bounds = resolveDateBounds(range, url.searchParams.get("startDate") || undefined, url.searchParams.get("endDate") || undefined);

    const filter: Record<string, any> = {};

    if (user.role === "SUPER_ADMIN") {
      if (url.searchParams.get("organizationId")) filter.organizationId = url.searchParams.get("organizationId");
    } else if (user.role === "ADMIN") {
      filter.organizationId = user.organizationId;
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      filter.organizationId = user.organizationId;
      const scope = await getManagementScope(user);
      filter.assignedTo = { $in: scope.scopedUserIds };
    }

    const attentionItems = await AnalyticsService.getAttentionQueue(filter, bounds);
    return success({ dateRange: bounds, items: attentionItems });
  } catch (err: any) {
    return error("GET_ATTENTION_QUEUE_FAILED", err.message || "Failed to load attention queue", 500);
  }
}
