import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as crmCallService from "../../../../services/crmCallService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId") || (user.role === "SUPER_ADMIN" || user.role === "ADMIN" ? undefined : String(user._id));

  const queue = await crmCallService.getFollowUpQueue(String(user.organizationId), employeeId);
  return success(queue);
}
