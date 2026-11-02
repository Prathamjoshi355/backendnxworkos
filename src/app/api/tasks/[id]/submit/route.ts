import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { submitTask } from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = await submitTask(id, String(user._id), body);
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to submit task";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "You cannot submit this task", 403);
    return error("TASK_SUBMIT_FAILED", message, 500);
  }
}
