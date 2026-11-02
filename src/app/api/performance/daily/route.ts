import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { PerformanceScoreService } from "../../../../services/performanceScoreService";
import { getManagementScope } from "../../../../utils/scopeHelper";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date") || url.searchParams.get("reportDate");
    const targetDate = dateParam ? new Date(dateParam) : new Date();

    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const targetUserId = url.searchParams.get("userId") || String(user._id);

    if (targetUserId !== String(user._id)) {
      if (user.role === "SUPER_ADMIN") {
        // Allowed
      } else if (user.role === "ADMIN") {
        // Allowed within org
      } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
        const scope = await getManagementScope(user);
        if (!scope.scopedUserIds.includes(targetUserId)) {
          return error("FORBIDDEN", "Forbidden", 403);
        }
      } else {
        return error("FORBIDDEN", "Forbidden", 403);
      }
    }

    const orgId = String(user.organizationId || "");
    const result = await PerformanceScoreService.calculateDailyPerformanceScore(
      targetUserId,
      orgId,
      start,
      end
    );

    return success(result);
  } catch (err: any) {
    return error("GET_DAILY_PERFORMANCE_FAILED", err.message || "Failed to calculate daily performance", 500);
  }
}
