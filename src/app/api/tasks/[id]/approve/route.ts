import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { approveTask } from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await context.params;
    const task = await approveTask(id, user);
    return success({ task });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to approve task";
    if (message === "UNAUTHORIZED_TASK_REVIEW") {
      return error("FORBIDDEN", "You are not authorized to approve tasks outside your management scope.", 403);
    }
    if (message === "TASK_ALREADY_APPROVED") {
      return error("VALIDATION_ERROR", "Task is already approved", 422);
    }
    if (message === "TASK_NOT_FOUND") {
      return error("NOT_FOUND", "Task not found", 404);
    }
    return error("TASK_APPROVE_FAILED", message, 500);
  }
}
