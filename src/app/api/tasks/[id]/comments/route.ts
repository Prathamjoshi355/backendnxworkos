import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as taskService from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const comment = body.comment || body.message || body.remark;

    if (!comment || String(comment).trim().length === 0) {
      return error("VALIDATION_ERROR", "Comment text is required", 422);
    }

    const updated = await taskService.addCommentToTask(id, String(comment).trim(), user);
    return success({ task: updated, remarks: updated?.remarks || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to add comment";
    if (message === "TASK_NOT_FOUND") return error("NOT_FOUND", "Task not found", 404);
    if (message === "COMMENT_REQUIRED") return error("VALIDATION_ERROR", "Comment text is required", 422);
    return error("TASK_COMMENT_FAILED", message, 500);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const task: any = await taskService.getTaskById(id);
    if (!task) return error("NOT_FOUND", "Task not found", 404);

    return success({ remarks: task.remarks || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to fetch remarks";
    return error("TASK_COMMENTS_FETCH_FAILED", message, 500);
  }
}
