import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { DailyWorkReportService } from "../../../../services/dailyWorkReportService";
import { PerformanceService } from "../../../../services/performanceService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    const date = dateParam ? new Date(dateParam) : new Date();
    const targetUserId = url.searchParams.get("userId") || String(user._id);

    if (targetUserId !== String(user._id) && !["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role)) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const dayData = await DailyWorkReportService.calculateDaySnapshot(targetUserId, date);
    const score = PerformanceService.calculateScore({
      totalTasksAssigned: dayData.totalTasksAssigned,
      totalTasksCompleted: dayData.totalTasksCompleted,
      totalTasksPending: dayData.totalTasksPending,
      totalTasksRejected: dayData.totalTasksRejected,
      totalTasksReworked: dayData.totalTasksReworked,
      tasksOverdue: dayData.tasksOverdue,
      totalEstimatedMinutes: dayData.totalEstimatedMinutes,
      totalActualMinutes: dayData.totalActualMinutes,
      productiveMinutes: dayData.productiveMinutes,
      isLeaveDay: dayData.isLeaveDay,
      isPartialDay: dayData.isPartialDay,
    });

    return success({
      date: date.toISOString().split("T")[0],
      userId: targetUserId,
      snapshot: dayData,
      performance: score,
    });
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : 500;
    return error("GET_PERFORMANCE_FAILED", err.message || "Failed to calculate performance", status);
  }
}
