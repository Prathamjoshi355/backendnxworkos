import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as announcementService from "../../../../services/announcementService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const unreadCount = await announcementService.getUnreadAnnouncementCount(user);
    return success({ unreadCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to get unread count";
    return error("ANNOUNCEMENT_UNREAD_COUNT_FAILED", message, 500);
  }
}
