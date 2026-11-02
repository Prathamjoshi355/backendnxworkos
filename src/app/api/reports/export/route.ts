import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as reportService from "../../../../services/reportService";
import { error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (queryParams[k] = v));

    const category = queryParams.category || "overview";

    const { filename, csv } = await reportService.exportReportCsv(category, user, queryParams);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "FORBIDDEN_COMPENSATION_REPORT") {
        return error("FORBIDDEN", "Unauthorized to access compensation reports", 403);
      }
      return error("REPORT_EXPORT_FAILED", err.message, 500);
    }
    return error("REPORT_EXPORT_FAILED", "Unable to export report", 500);
  }
}
