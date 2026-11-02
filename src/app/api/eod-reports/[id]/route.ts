import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { EODReportUpdateSchema } from "../../../../validators/eodReport";
import * as eodReportService from "../../../../services/eodReportService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const report = await eodReportService.getEODReportById(id, user);
    return success({ report });
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : err.message === "REPORT_NOT_FOUND" ? 404 : 500;
    return error(err.message || "GET_EOD_FAILED", err.message, status);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const existing = await eodReportService.getEODReportById(id, user);

    if (String((existing.userId as any)?._id || existing.userId) !== String(user._id)) {
      return error("FORBIDDEN", "Only report author can update draft", 403);
    }

    if (["APPROVED", "LOCKED"].includes(existing.status)) {
      return error("CANNOT_MODIFY_APPROVED_REPORT", "Approved reports cannot be edited", 400);
    }

    const body = await request.json();
    const parsed = EODReportUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return error("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const report = await eodReportService.createOrUpdateEODReport(String(user._id), {
      ...parsed.data,
      reportDate: existing.reportDate,
    });
    return success({ report });
  } catch (err: any) {
    return error(err.message || "UPDATE_EOD_FAILED", err.message, 500);
  }
}
