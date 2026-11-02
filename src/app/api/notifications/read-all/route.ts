import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { markAllAsRead } from "../../../../services/notificationService";
import Notification from "../../../../models/Notification";
import { success, error } from "../../../../utils/response";

export async function PATCH(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (user.role === "SUPER_ADMIN" && user.organizationId) {
      await Notification.updateMany({ organizationId: user.organizationId, isRead: false }, { isRead: true, readAt: new Date() });
      const notifications = await Notification.find({ organizationId: user.organizationId }).sort({ createdAt: -1 }).lean();
      return success({ notifications });
    }

    const notifications = await markAllAsRead(String(user._id));
    return success({ notifications });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to mark notifications as read";
    return error("NOTIFICATION_BULK_READ_FAILED", message, 500);
  }
}
