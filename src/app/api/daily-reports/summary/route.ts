import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { DailyWorkReportService } from "../../../../services/dailyWorkReportService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    const date = dateParam ? new Date(dateParam) : new Date();

    const summary = await DailyWorkReportService.getSummary(user, date);
    return success(summary);
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : 500;
    return error("GET_SUMMARY_FAILED", err.message || "Failed to get daily reports summary", status);
  }
}
