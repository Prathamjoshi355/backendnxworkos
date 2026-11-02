import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { DailyWorkReportService } from "../../../../../services/dailyWorkReportService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const report = await DailyWorkReportService.submitReport(id, user);
    return success({ report, message: "Daily work report submitted successfully" });
  } catch (err: any) {
    const status =
      err.message === "FORBIDDEN"
        ? 403
        : err.message === "REPORT_ALREADY_LOCKED"
        ? 400
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("SUBMIT_DAILY_REPORT_FAILED", err.message || "Failed to submit daily report", status);
  }
}
