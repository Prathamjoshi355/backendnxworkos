import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { createTask, isCategoryAllowedForRole } from "../../../../services/taskService";
import { TaskCreateSchema } from "../../../../validators/task";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const body = await request.json();
    const parsed = TaskCreateSchema.safeParse(body);
    if (!parsed.success) {
      return error("VALIDATION_ERROR", parsed.error.message, 422);
    }

    const category = String(parsed.data.category || "GENERAL").toUpperCase();
    if (!isCategoryAllowedForRole(user.role, category)) {
      return error("FORBIDDEN", `Role ${user.role} is not authorized to self-assign category ${category}`, 403);
    }

    // Force self-assignment and trusted user session fields
    const selfPayload = {
      ...parsed.data,
      category,
      assignedTo: String(user._id),
      assignedBy: String(user._id),
      organizationId: String(user.organizationId || parsed.data.organizationId || ""),
    };

    const created = await createTask(selfPayload);
    return success({ task: created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to self-assign task";
    if (message === "TITLE_REQUIRED") return error("TITLE_REQUIRED", "Title is required", 422);
    return error("TASK_CREATE_FAILED", message, 500);
  }
}
