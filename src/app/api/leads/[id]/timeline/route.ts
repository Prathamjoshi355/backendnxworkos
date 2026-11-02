import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as crmCallService from "../../../../../services/crmCallService";
import { success, error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const { id } = await context.params;
    const data = await crmCallService.getLeadTimeline(id, String(user.organizationId));
    return success(data);
  } catch (err: any) {
    return error("TIMELINE_FAILED", err.message || "Failed to fetch lead timeline", 500);
  }
}
