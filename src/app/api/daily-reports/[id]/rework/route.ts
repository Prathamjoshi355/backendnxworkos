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
    const reason = body.reason || body.comment || body.remarks || "";

    if (!reason || reason.trim().length === 0) {
      return error("REWORK_REASON_REQUIRED", "A reason is required when requesting rework", 422);
    }

    const report = await DailyWorkReportService.requestRework(id, user, reason.trim());
    return success({ report, message: "Report returned for rework" });
  } catch (err: any) {
    const status =
      err.message === "CANNOT_REVIEW_OWN_REPORT"
        ? 400
        : err.message === "FORBIDDEN"
        ? 403
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("REQUEST_REWORK_FAILED", err.message || "Failed to request rework", status);
  }
}
