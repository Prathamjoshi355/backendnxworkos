import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { markAsRead } from "../../../../../services/notificationService";
import Notification from "../../../../../models/Notification";
import { success, error } from "../../../../../utils/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    let notification = await markAsRead(id, String(user._id));
    if (!notification && user.role === "SUPER_ADMIN") {
      notification = await Notification.findOneAndUpdate(
        { _id: id, organizationId: user.organizationId },
        { isRead: true, readAt: new Date() },
        { new: true }
      ).lean();
    }
    if (!notification) return error("NOT_FOUND", "Notification not found", 404);

    return success({ notification });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to mark notification as read";
    return error("NOTIFICATION_READ_FAILED", message, 500);
  }
}
