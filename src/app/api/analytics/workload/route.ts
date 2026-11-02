import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { AnalyticsService } from "../../../../services/analyticsService";
import { getManagementScope } from "../../../../utils/scopeHelper";
import User from "../../../../models/User";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    let targetUserIds: string[] = [];

    if (user.role === "SUPER_ADMIN") {
      const orgId = url.searchParams.get("organizationId");
      const users = await User.find(orgId ? { organizationId: orgId } : {}).select("_id").limit(50).lean();
      targetUserIds = users.map((u) => String(u._id));
    } else if (user.role === "ADMIN") {
      const teamId = url.searchParams.get("teamId");
      const deptId = url.searchParams.get("departmentId");
      const filter: Record<string, any> = { organizationId: user.organizationId };
      if (teamId) filter.teamId = teamId;
      if (deptId) filter.departmentId = deptId;
      const users = await User.find(filter).select("_id").limit(50).lean();
      targetUserIds = users.map((u) => String(u._id));
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      const scope = await getManagementScope(user);
      targetUserIds = scope.scopedUserIds;
    } else {
      targetUserIds = [String(user._id)];
    }

    const workload = await AnalyticsService.getWorkloadMetrics(targetUserIds, String(user.organizationId || ""));
    return success({ workload });
  } catch (err: any) {
    return error("GET_WORKLOAD_ANALYTICS_FAILED", err.message || "Failed to load workload analytics", 500);
  }
}
