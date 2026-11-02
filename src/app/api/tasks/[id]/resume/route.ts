import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { resumeTaskTimer } from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await context.params;
    const task = await resumeTaskTimer(id, String(user._id));
    return success({ task });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to resume task";
    return error("TASK_RESUME_FAILED", message, 500);
  }
}
