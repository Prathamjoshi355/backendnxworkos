import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { EODReportReviewSchema } from "../../../../../validators/eodReport";
import * as eodReportService from "../../../../../services/eodReportService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Only managers, team leads, and admins can approve reports", 403);
    }

    const { id } = await context.params;
    let remarks = "";
    try {
      const body = await request.json();
      remarks = body.reviewRemarks || body.reviewerRemarks || body.remarks || "";
    } catch (_) {}

    const report = await eodReportService.approveEODReport(id, user, remarks);
    return success({ report, message: "EOD report approved successfully" });
  } catch (err: any) {
    const status =
      err.message === "FORBIDDEN"
        ? 403
        : err.message === "CANNOT_REVIEW_OWN_REPORT"
        ? 400
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error(err.message || "APPROVE_EOD_FAILED", err.message, status);
  }
}

export const PATCH = POST;

