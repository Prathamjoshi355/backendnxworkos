import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { rejectTask } from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await context.params;
    const body = await request.json();
    const reason = String(body.reason || "Task rejected");
    const task = await rejectTask(id, reason, user);
    return success({ task });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to reject task";
    if (message === "UNAUTHORIZED_TASK_REVIEW") {
      return error("FORBIDDEN", "You are not authorized to reject tasks outside your management scope.", 403);
    }
    if (message === "TASK_NOT_FOUND") {
      return error("NOT_FOUND", "Task not found", 404);
    }
    return error("TASK_REJECT_FAILED", message, 500);
  }
}
