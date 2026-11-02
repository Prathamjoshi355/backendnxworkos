import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as taskService from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const result = await taskService.getTaskTimeline(id, user);
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to fetch task timeline";
    if (message === "TASK_NOT_FOUND") return error("NOT_FOUND", "Task not found", 404);
    return error("TASK_TIMELINE_FAILED", message, 500);
  }
}
