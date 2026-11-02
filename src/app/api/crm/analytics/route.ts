import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as crmAnalyticsService from "../../../../services/crmAnalyticsService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  const scopedUserIds = (user.role === "SUPER_ADMIN" || user.role === "ADMIN") ? undefined : [String(user._id)];
  const analytics = await crmAnalyticsService.getCRMDashboardAnalytics(String(user.organizationId), scopedUserIds);
  return success(analytics);
}
