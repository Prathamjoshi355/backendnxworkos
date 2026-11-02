import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getDashboard } from "../../../../services/dashboardService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const range = url.searchParams.get("range") || url.searchParams.get("dateRange") || "today";

    const dashboard = await getDashboard(user, { roleOverride: "EMPLOYEE", period: range });

    return success({
      ...dashboard,
      // Backwards-compatibility aliases for existing clients
      attendance: dashboard.todayWork,
      taskSummary: dashboard.tasks,
      eodReport: { status: dashboard.performance?.eodStatus },
      performanceScore: dashboard.performance?.score,
      points: dashboard.performance?.points,
      workStatus: dashboard.todayWork?.workStatus,
    });
  } catch (err: any) {
    return error("GET_EMPLOYEE_DASHBOARD_FAILED", err.message || "Failed to load employee dashboard", 500);
  }
}
