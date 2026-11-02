import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import User from "../../../../../models/User";
import { PerformanceSnapshot } from "../../../../../models/PerformanceSnapshot";
import { PerformanceScoreService } from "../../../../../services/performanceScoreService";
import { getManagementScope } from "../../../../../utils/scopeHelper";
import { success, error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id: targetUserId } = await context.params;
    const targetUser = await User.findById(targetUserId).select("-passwordHash").lean();
    if (!targetUser) return error("USER_NOT_FOUND", "Employee not found", 404);

    // Authority checks
    if (String(authUser._id) !== targetUserId) {
      if (authUser.role === "SUPER_ADMIN") {
        // Allowed
      } else if (authUser.role === "ADMIN") {
        if (String(targetUser.organizationId) !== String(authUser.organizationId)) {
          return error("FORBIDDEN", "Forbidden", 403);
        }
      } else if (authUser.role === "MANAGER" || authUser.role === "TEAM_LEADER") {
        const scope = await getManagementScope(authUser);
        if (!scope.scopedUserIds.includes(targetUserId)) {
          return error("FORBIDDEN", "Forbidden", 403);
        }
      } else {
        return error("FORBIDDEN", "Forbidden", 403);
      }
    }

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 30);

    const snapshots = await PerformanceSnapshot.find({
      userId: targetUserId,
      periodType: "DAILY",
    })
      .sort({ periodStart: -1 })
      .limit(limit)
      .lean();

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const todayLiveScore = await PerformanceScoreService.calculateDailyPerformanceScore(
      targetUserId,
      String(targetUser.organizationId || ""),
      start,
      end
    );

    return success({
      user: targetUser,
      today: todayLiveScore,
      snapshots,
    });
  } catch (err: any) {
    return error("GET_EMPLOYEE_PERFORMANCE_FAILED", err.message || "Failed to get employee performance", 500);
  }
}
