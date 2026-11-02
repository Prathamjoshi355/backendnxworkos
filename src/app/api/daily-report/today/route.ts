import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as eodReportService from "../../../../services/eodReportService";
import DailyReport from "../../../../models/DailyReport";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date") || url.searchParams.get("reportDate");
    const targetDate = dateParam ? new Date(dateParam) : new Date();

    const start = eodReportService.startOfDay(targetDate);
    const end = eodReportService.endOfDay(targetDate);

    const [hierarchy, taskData, existingReport] = await Promise.all([
      eodReportService.resolveUserHierarchy(String(user._id)),
      eodReportService.getAuthoritativeDayTaskData(String(user._id), targetDate),
      DailyReport.findOne({
        userId: String(user._id),
        reportDate: { $gte: start, $lte: end },
      })
        .populate("completedTaskIds", "_id taskId title status priority completionPercentage")
        .populate("inProgressTaskIds", "_id taskId title status priority completionPercentage")
        .populate("pendingTaskIds", "_id taskId title status priority completionPercentage")
        .populate("reviewedBy", "_id fullName email employeeId designation")
        .lean(),
    ]);

    return success({
      date: start,
      hierarchy,
      taskSummary: taskData,
      report: existingReport || null,
      isSubmitted: existingReport ? ["SUBMITTED", "APPROVED", "LOCKED"].includes(existingReport.status) : false,
    });
  } catch (err: any) {
    return error("GET_TODAY_EOD_FAILED", err.message || "Failed to load today EOD", 500);
  }
}
