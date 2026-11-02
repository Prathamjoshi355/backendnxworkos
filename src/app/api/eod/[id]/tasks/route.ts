import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { EODService } from "../../../../../services/eodService";
import { success, error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const tasks = await EODService.getEODTasks(id, user);
    return success({ tasks });
  } catch (err: any) {
    const status =
      err.message === "FORBIDDEN"
        ? 403
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("GET_EOD_TASKS_FAILED", err.message || "Failed to fetch underlying tasks for EOD", status);
  }
}
