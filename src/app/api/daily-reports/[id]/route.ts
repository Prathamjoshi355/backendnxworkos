import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { DailyWorkReportService } from "../../../../services/dailyWorkReportService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const report = await DailyWorkReportService.getReportById(id, user);
    return success({ report });
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : err.message === "REPORT_NOT_FOUND" ? 404 : 500;
    return error("GET_DAILY_REPORT_FAILED", err.message || "Failed to get daily report", status);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const report = await DailyWorkReportService.getReportById(id, user);

    const targetUserId = String((report.userId as any)?._id || report.userId);
    if (targetUserId !== String(user._id) && !["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const body = await request.json();
    const updated = await DailyWorkReportService.createOrUpdateReport(targetUserId, {
      ...body,
      reportDate: report.reportDate,
    });

    return success({ report: updated, message: "Daily report updated successfully" });
  } catch (err: any) {
    const status =
      err.message === "REPORT_ALREADY_LOCKED"
        ? 400
        : err.message === "FORBIDDEN"
        ? 403
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("UPDATE_DAILY_REPORT_FAILED", err.message || "Failed to update daily report", status);
  }
}
