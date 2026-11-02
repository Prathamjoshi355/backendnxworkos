import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { DailyWorkReportService } from "../../../../../services/dailyWorkReportService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await context.params;
    const body = await request.json();

    const report = await DailyWorkReportService.reviewReport(id, user, {
      comment: body.comment || body.remarks || body.reviewerRemarks || body.reviewerComment,
      score: typeof body.score === "number" ? body.score : undefined,
      action: body.action || body.status,
    });

    return success({ report, message: "Report review recorded successfully" });
  } catch (err: any) {
    const status =
      err.message === "CANNOT_REVIEW_OWN_REPORT"
        ? 400
        : err.message === "FORBIDDEN"
        ? 403
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("REVIEW_DAILY_REPORT_FAILED", err.message || "Failed to review daily report", status);
  }
}

export const PATCH = POST;
