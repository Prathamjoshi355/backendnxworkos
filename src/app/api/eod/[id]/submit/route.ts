import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { EODService } from "../../../../../services/eodService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const report = await EODService.submitEOD(id, user);
    return success({ report, message: "EOD report submitted for review" });
  } catch (err: any) {
    const status =
      err.message === "FORBIDDEN"
        ? 403
        : err.message === "EOD_ALREADY_LOCKED"
        ? 400
        : err.message === "REPORT_NOT_FOUND"
        ? 404
        : 500;
    return error("SUBMIT_EOD_FAILED", err.message || "Failed to submit EOD report", status);
  }
}
