import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getUnreadCount } from "../../../../services/notificationService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const count = await getUnreadCount(String(user._id));
    return success({ unreadCount: count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to get unread count";
    return error("NOTIFICATION_UNREAD_COUNT_FAILED", message, 500);
  }
}
