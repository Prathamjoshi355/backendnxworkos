import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as leaveService from "../../../../../services/leaveService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const leave = await leaveService.cancelLeave(id, user);
    return success({ leave });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to cancel leave";
    if (message === "LEAVE_NOT_FOUND") return error("NOT_FOUND", "Leave request not found", 404);
    if (message === "UNAUTHORIZED_CANCEL" || message === "FORBIDDEN") return error("FORBIDDEN", "Unauthorized to cancel this leave", 403);
    if (message === "CANNOT_CANCEL_PROCESSED_LEAVE") return error("VALIDATION_ERROR", "Only pending leave requests can be cancelled", 422);
    return error("LEAVE_CANCEL_FAILED", message, 500);
  }
}
