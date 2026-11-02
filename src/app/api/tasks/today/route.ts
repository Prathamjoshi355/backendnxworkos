import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getTodayWorkSummary } from "../../../../services/taskService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const summary = await getTodayWorkSummary(String(user._id));
    return success(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to get task summary";
    return error("TASK_SUMMARY_FAILED", message, 500);
  }
}
