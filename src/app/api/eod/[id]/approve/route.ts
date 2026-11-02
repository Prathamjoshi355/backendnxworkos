import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { EODService } from "../../../../../services/eodService";
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
    const body = await request.json().catch(() => ({}));
    const remarks = body.remarks || body.reviewRemarks || body.reviewerRemarks || "";
    const score = typeof body.score === "number" ? body.score : undefined;

    const report = await EODService.approveEOD(id, user, remarks, score);
    return success({ report, message: "EOD report approved successfully" });
  } catch (err: any) {
    const status =
      err.message === "CANNOT_REVIEW_OWN_REPORT"
        ? 400
        : err.message === "FORBIDDEN"
        ? 403
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("APPROVE_EOD_FAILED", err.message || "Failed to approve EOD report", status);
  }
}

export const PATCH = POST;
