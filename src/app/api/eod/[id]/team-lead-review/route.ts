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
    const body = await request.json();

    const report = await EODService.teamLeadReview(id, user, {
      remarks: body.remarks || body.teamLeadRemarks || body.reviewerRemarks,
      score: typeof body.score === "number" ? body.score : typeof body.teamLeadScore === "number" ? body.teamLeadScore : undefined,
      action: body.action || body.status,
    });

    return success({ report, message: "Team Lead review recorded successfully" });
  } catch (err: any) {
    const status =
      err.message === "CANNOT_REVIEW_OWN_REPORT"
        ? 400
        : err.message === "FORBIDDEN"
        ? 403
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("TEAM_LEAD_REVIEW_FAILED", err.message || "Failed to submit Team Lead review", status);
  }
}
