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
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await context.params;
    const body = await request.json();
    const action = String(body.action || body.status || "APPROVED").toUpperCase();
    const remarks = body.reviewRemarks || body.reviewerRemarks || body.reworkReason || body.remarks || "";

    if (action === "APPROVED" || action === "APPROVE") {
      const report = await eodReportService.approveEODReport(id, user, remarks);
      return success({ report, message: "EOD report approved" });
    } else {
      if (!remarks || remarks.trim().length === 0) {
        return error("REWORK_REASON_REQUIRED", "Remarks are required when returning an EOD report", 422);
      }
      const report = await eodReportService.returnEODReport(id, user, remarks);
      return success({ report, message: "EOD report returned for rework" });
    }
  } catch (err: any) {
    const status =
      err.message === "FORBIDDEN"
        ? 403
        : err.message === "CANNOT_REVIEW_OWN_REPORT"
        ? 400
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error(err.message || "REVIEW_EOD_FAILED", err.message, status);
  }
}

export const PATCH = POST;

