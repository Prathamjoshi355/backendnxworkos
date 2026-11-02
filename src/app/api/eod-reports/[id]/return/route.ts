import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import * as eodReportService from "../../../../../services/eodReportService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Only managers, team leads, and admins can return reports", 403);
    }

    const { id } = await context.params;
    const body = await request.json();
    const reworkReason = body.reworkReason || body.reviewRemarks || body.reviewerRemarks || body.reason || body.remarks;

    if (!reworkReason || reworkReason.trim().length === 0) {
      return error("REWORK_REASON_REQUIRED", "Review remarks / rework reason are required when returning an EOD report", 422);
    }

    const report = await eodReportService.returnEODReport(id, user, reworkReason);
    return success({ report, message: "EOD report returned for rework" });
  } catch (err: any) {
    const status =
      err.message === "FORBIDDEN"
        ? 403
        : err.message === "CANNOT_REVIEW_OWN_REPORT"
        ? 400
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error(err.message || "RETURN_EOD_FAILED", err.message, status);
  }
}
