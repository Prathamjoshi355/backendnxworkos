import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { startTaskTimer } from "../../../../../services/taskService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const result = await startTaskTimer(id, String(user._id));
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to start task timer";
    if (message === "ATTENDANCE_NOT_ACTIVE") return error("ATTENDANCE_NOT_ACTIVE", "You must be online to start a task timer", 409);
    if (message === "ATTENDANCE_ON_BREAK") return error("ATTENDANCE_ON_BREAK", "Finish the active break before starting a task timer", 409);
    if (message === "FORBIDDEN") return error("FORBIDDEN", "You cannot start this task", 403);
    if (message === "ACTIVE_TASK_TIMER_EXISTS") return error("ACTIVE_TASK_TIMER_EXISTS", "A task timer is already active", 409);
    return error("TASK_TIMER_START_FAILED", message, 500);
  }
}
