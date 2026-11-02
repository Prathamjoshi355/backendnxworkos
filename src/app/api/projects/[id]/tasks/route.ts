import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as projectService from "../../../../../services/projectService";
import { success, error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const tasks = await projectService.getProjectTasks((await context.params).id, user);
    return success({ tasks, total: tasks.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to get project tasks";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "PROJECT_NOT_FOUND") return error("NOT_FOUND", "Project not found", 404);
    return error("PROJECT_TASKS_FAILED", message, 500);
  }
}
