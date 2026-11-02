import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { resolveDateBounds } from "../../../../services/analyticsService";
import { PerformanceSnapshot } from "../../../../models/PerformanceSnapshot";
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

    const filter: Record<string, any> = {
      periodStart: { $gte: bounds.start, $lte: bounds.end },
    };

    if (user.role === "SUPER_ADMIN") {
      if (url.searchParams.get("organizationId")) filter.organizationId = url.searchParams.get("organizationId");
    } else if (user.role === "ADMIN") {
      filter.organizationId = user.organizationId;
      if (url.searchParams.get("userId")) filter.userId = url.searchParams.get("userId");
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      filter.organizationId = user.organizationId;
      const scope = await getManagementScope(user);
      if (url.searchParams.get("userId")) {
        const target = url.searchParams.get("userId")!;
        if (!scope.scopedUserIds.includes(target)) return error("FORBIDDEN", "Forbidden", 403);
        filter.userId = target;
      } else {
        filter.userId = { $in: scope.scopedUserIds };
      }
    } else {
      filter.userId = String(user._id);
    }

    const snapshots = await PerformanceSnapshot.find(filter)
      .populate("userId", "_id fullName employeeId designation")
      .sort({ periodStart: -1 })
      .lean();

    return success({ dateRange: bounds, snapshots });
  } catch (err: any) {
    return error("GET_PERFORMANCE_ANALYTICS_FAILED", err.message || "Failed to load performance analytics", 500);
  }
}
