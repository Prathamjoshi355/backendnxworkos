import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import { EODReportCreateSchema } from "../../../validators/eodReport";
import * as eodReportService from "../../../services/eodReportService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const result = await eodReportService.listEODReports(user, query);
    return success(result);
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : 500;
    return error(err.message || "LIST_EOD_FAILED", err.message, status);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    const parsed = EODReportCreateSchema.safeParse(body);
    if (!parsed.success) {
      return error("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const report = await eodReportService.createOrUpdateEODReport(String(user._id), parsed.data);
    return success({ report }, 201);
  } catch (err: any) {
    const status = err.message === "CANNOT_MODIFY_APPROVED_REPORT" ? 400 : 500;
    return error(err.message || "CREATE_EOD_FAILED", err.message, status);
  }
}
