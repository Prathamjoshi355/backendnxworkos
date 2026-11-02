import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as reportService from "../../../../services/reportService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ category: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { category } = await context.params;
    const url = new URL(request.url);
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (queryParams[k] = v));

    const isCsvExport = queryParams.format === "csv" || queryParams.export === "csv";

    if (isCsvExport) {
      const { filename, csv } = await reportService.exportReportCsv(category, user, queryParams);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const report = await reportService.getCategoryReport(category, user, queryParams);
    return success(report);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "FORBIDDEN_COMPENSATION_REPORT") {
        return error("FORBIDDEN", "Unauthorized to access compensation reports", 403);
      }
      if (err.message.startsWith("INVALID_REPORT_CATEGORY")) {
        return error("INVALID_CATEGORY", err.message, 400);
      }
      return error("REPORT_FAILED", err.message, 500);
    }
    return error("REPORT_FAILED", "Unable to load report", 500);
  }
}
