import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { DailyWorkReportService } from "../../../../../services/dailyWorkReportService";
import { success, error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const timeline = await DailyWorkReportService.getReportTimeline(id, user);
    return success(timeline);
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : err.message === "REPORT_NOT_FOUND" ? 404 : 500;
    return error("GET_TIMELINE_FAILED", err.message || "Failed to get report timeline", status);
  }
}
