import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as eodReportService from "../../../../../services/eodReportService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const existing = await eodReportService.getEODReportById(id, user);

    if (String((existing.userId as any)?._id || existing.userId) !== String(user._id)) {
      return error("FORBIDDEN", "Only report author can submit", 403);
    }

    const report = await eodReportService.createOrUpdateEODReport(String(user._id), {
      ...existing,
      reportDate: existing.reportDate,
      action: "SUBMIT",
      status: "SUBMITTED",
    });

    return success({ report });
  } catch (err: any) {
    return error(err.message || "SUBMIT_EOD_FAILED", err.message, 500);
  }
}
