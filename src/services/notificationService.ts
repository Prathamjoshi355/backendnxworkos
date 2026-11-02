import Notification, { NotificationPriority, NotificationType } from "../models/Notification";
import { getSocket } from "../lib/socket";

export type NotificationPayload = {
  recipientId: string;
  organizationId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  priority?: NotificationPriority;
  expiresAt?: Date | string | null;
  dedupeKey?: string | null;
};

export async function createNotification(payload: NotificationPayload) {
  const recipientId = String(payload.recipientId || "").trim();
  if (!recipientId) throw new Error("RECIPIENT_REQUIRED");

  const dedupeKey = payload.dedupeKey || `${payload.type}:${recipientId}:${payload.entityType || ""}:${payload.entityId || ""}`;
  const existing = await Notification.findOne({ recipientId, dedupeKey }).lean();
  if (existing) return existing;

  const record = await Notification.create({
    recipientId,
    organizationId: payload.organizationId || null,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    entityType: payload.entityType || null,
    entityId: payload.entityId || null,
    priority: payload.priority || "NORMAL",
    isRead: false,
    readAt: null,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    dedupeKey,
  });

  try {
    const socket = getSocket();
    socket.to(`user:${recipientId}`).emit("notification:new", {
      notificationId: String(record._id),
      type: record.type,
      title: record.title,
      message: record.message,
      entityType: record.entityType,
      entityId: record.entityId,
      priority: record.priority,
      createdAt: record.createdAt,
    });
  } catch {
    // ignore socket issues outside of server runtime
  }

  return record.toObject();
}

export async function createBulkNotifications(items: NotificationPayload[]) {
  const results: any[] = [];
  for (const item of items) {
    const result = await createNotification(item);
    results.push(result);
  }
  return results;
}

export async function markAsRead(notificationId: string, userId: string) {
  const item = await Notification.findOne({ _id: notificationId, recipientId: userId }).lean();
  if (!item) return null;
  const updated = await Notification.findByIdAndUpdate(
    notificationId,
    { isRead: true, readAt: new Date() },
    { new: true }
  ).lean();
  return updated;
}

export async function markAllAsRead(userId: string) {
  await Notification.updateMany({ recipientId: userId, isRead: false }, { isRead: true, readAt: new Date() });
  return await Notification.find({ recipientId: userId }).sort({ createdAt: -1 }).lean();
}

export async function getUserNotifications(userId: string, params: Record<string, any> = {}) {
  const {
    page = 1,
    limit = 20,
    unreadOnly = false,
    type,
    priority,
    from,
    to,
    q,
  } = params;

  const filter: Record<string, any> = { recipientId: userId };
  if (unreadOnly) filter.isRead = false;
  if (type) filter.type = type;
  if (priority) filter.priority = priority;
  if (from || to) filter.createdAt = {} as Record<string, Date>;
  if (from) filter.createdAt.$gte = new Date(from);
  if (to) filter.createdAt.$lte = new Date(to);
  if (q) filter.$or = [
    { title: new RegExp(String(q), "i") },
    { message: new RegExp(String(q), "i") },
  ];

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Notification.countDocuments(filter),
  ]);

  return { items, total, page: Number(page), limit: Number(limit) };
}

export async function getUnreadCount(userId: string) {
  return Notification.countDocuments({ recipientId: userId, isRead: false });
}
