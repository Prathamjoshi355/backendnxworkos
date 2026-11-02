import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import * as leaveService from "../../../../../services/leaveService";
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
    const leave = await leaveService.reviewLeave(id, "APPROVED", user, body.comment);
    return success({ leave });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to approve leave";
    if (message === "LEAVE_NOT_FOUND") return error("NOT_FOUND", "Leave request not found", 404);
    if (message === "CANNOT_APPROVE_OWN_LEAVE") return error("FORBIDDEN", "Self-approval is prohibited. You cannot approve your own leave application.", 403);
    if (message === "LEAVE_USER_OUTSIDE_SCOPE") return error("FORBIDDEN", "Target employee is outside your management scope.", 403);
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "LEAVE_ALREADY_PROCESSED") return error("VALIDATION_ERROR", "Leave request has already been processed", 422);
    return error("LEAVE_APPROVE_FAILED", message, 500);
  }
}
