import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as leaveService from "../../../../services/leaveService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const targetUserId = url.searchParams.get("userId") || String(user._id);

    // If viewing another user's balance, require Admin or Super Admin
    if (targetUserId !== String(user._id) && !["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role)) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const balances = await leaveService.getLeaveBalance(targetUserId, String(user.organizationId));
    return success({ balances });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load leave balance";
    return error("LEAVE_BALANCE_FAILED", message, 500);
  }
}
