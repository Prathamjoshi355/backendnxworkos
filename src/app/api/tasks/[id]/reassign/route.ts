import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import * as taskService from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Unauthorized to reassign tasks", 403);
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const newAssigneeId = body.assignedTo || body.assignedToId || body.userId;
    const reason = body.reason || body.reassignmentReason;

    if (!newAssigneeId) {
      return error("VALIDATION_ERROR", "New assignee ID (assignedTo) is required", 422);
    }

    const updated = await taskService.reassignTask(id, String(newAssigneeId), user, reason);
    return success({ task: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to reassign task";
    if (message === "TASK_NOT_FOUND") return error("NOT_FOUND", "Task not found", 404);
    if (message === "CANNOT_ASSIGN_OUTSIDE_SCOPE") return error("FORBIDDEN", "Target assignee is outside your management scope", 403);
    if (message === "ASSIGNED_USER_NOT_FOUND") return error("NOT_FOUND", "Assigned user not found", 404);
    return error("TASK_REASSIGN_FAILED", message, 500);
  }
}
