import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as leaveService from "../../../../services/leaveService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const leave = await leaveService.getLeaveById(id, user);
    return success({ leave });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load leave details";
    if (message === "LEAVE_NOT_FOUND") return error("NOT_FOUND", "Leave request not found", 404);
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    return error("LEAVE_DETAIL_FAILED", message, 500);
  }
}
