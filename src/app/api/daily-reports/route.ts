import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import { DailyWorkReportService } from "../../../services/dailyWorkReportService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const filters: Record<string, any> = {
      status: url.searchParams.get("status") || undefined,
      startDate: url.searchParams.get("startDate") || undefined,
      endDate: url.searchParams.get("endDate") || undefined,
      teamId: url.searchParams.get("teamId") || undefined,
      departmentId: url.searchParams.get("departmentId") || undefined,
      employeeId: url.searchParams.get("employeeId") || url.searchParams.get("userId") || undefined,
      page: url.searchParams.get("page") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    };

    if (user.role === "SUPER_ADMIN") {
      filters.organizationId = url.searchParams.get("organizationId") || undefined;
    }

    const result = await DailyWorkReportService.listReports(user, filters);
    return success(result);
  } catch (err: any) {
    const status = err.message === "FORBIDDEN" ? 403 : 500;
    return error("LIST_DAILY_REPORTS_FAILED", err.message || "Failed to list daily reports", status);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    const targetUserId = String(body.userId || body.employeeId || user._id);

    if (targetUserId !== String(user._id) && !["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const report = await DailyWorkReportService.createOrUpdateReport(targetUserId, body);
    return success({ report, message: "Daily work report saved successfully" }, 201);
  } catch (err: any) {
    const status =
      err.message === "REPORT_ALREADY_LOCKED"
        ? 400
        : err.message === "REPORT_ALREADY_SUBMITTED"
        ? 400
        : err.message === "FORBIDDEN"
        ? 403
        : 500;
    return error("SAVE_DAILY_REPORT_FAILED", err.message || "Failed to save daily work report", status);
  }
}
