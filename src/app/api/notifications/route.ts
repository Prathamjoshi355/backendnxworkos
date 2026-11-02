import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import { getUserNotifications } from "../../../services/notificationService";
import Notification from "../../../models/Notification";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "20");
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const type = url.searchParams.get("type") || undefined;
    const priority = url.searchParams.get("priority") || undefined;
    const from = url.searchParams.get("from") || undefined;
    const to = url.searchParams.get("to") || undefined;
    const q = url.searchParams.get("q") || undefined;

    const organizationId = url.searchParams.get("organizationId");
    if (user.role === "SUPER_ADMIN" && organizationId) {
      const filter: Record<string, any> = { organizationId };
      if (unreadOnly) filter.isRead = false;
      if (type) filter.type = type;
      if (priority) filter.priority = priority;
      if (from || to) filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
      if (q) filter.$or = [{ title: new RegExp(String(q), "i") }, { message: new RegExp(String(q), "i") }];
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Notification.countDocuments(filter),
      ]);
      return success({ items, total, page, limit });
    }

    const result = await getUserNotifications(String(user._id), { page, limit, unreadOnly, type, priority, from, to, q });
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to fetch notifications";
    return error("NOTIFICATIONS_FETCH_FAILED", message, 500);
  }
}
