import mongoose from "mongoose";
import Announcement from "../models/Announcement";
import User from "../models/User";
import { createNotification } from "./notificationService";
import { recordAuditLog } from "./auditLogService";
import { getSocket } from "../lib/socket";
import { logger } from "../utils/logger";

function isAdminRole(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Builds the MongoDB query matching announcements visible to the given non-admin user
 */
export function buildUserAudienceQuery(user: any) {
  const userId = user._id || user.id;
  const userObjectId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;

  const conditions: any[] = [{ audienceType: "ALL" }];

  if (user.departmentId) {
    conditions.push({
      audienceType: "DEPARTMENT",
      departmentId: user.departmentId,
    });
  }

  if (user.teamId) {
    conditions.push({
      audienceType: "TEAM",
      teamId: user.teamId,
    });
  }

  if (user.role) {
    conditions.push({
      audienceType: "ROLE",
      role: user.role,
    });
  }

  if (user.employmentType) {
    conditions.push({
      audienceType: "EMPLOYMENT_TYPE",
      employmentType: user.employmentType,
    });
  }

  conditions.push({
    audienceType: "USER",
    targetUserId: userObjectId,
  });

  const now = new Date();

  return {
    organizationId: user.organizationId,
    status: "PUBLISHED",
    publishAt: { $lte: now },
    $or: conditions,
  };
}

export async function createAnnouncement(user: any, payload: any) {
  if (!isAdminRole(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const count = await Announcement.countDocuments({ organizationId: user.organizationId });
  const announcementId = `ANC-${String(count + 1).padStart(4, "0")}`;

  const audienceType = payload.audienceType || "ALL";

  let status = payload.status || "DRAFT";
  let publishAt = payload.publishAt ? new Date(payload.publishAt) : new Date();

  // If status is SCHEDULED or publishAt is in the future
  if (status === "SCHEDULED" || (status === "PUBLISHED" && publishAt.getTime() > Date.now())) {
    status = "SCHEDULED";
  }

  const announcement = await Announcement.create({
    announcementId,
    organizationId: user.organizationId,
    title: payload.title,
    message: payload.message,
    createdBy: user._id || user.id,
    audienceType,
    departmentId: payload.departmentId || null,
    teamId: payload.teamId || null,
    role: payload.role || null,
    employmentType: payload.employmentType || null,
    targetUserId: payload.targetUserId || null,
    priority: payload.priority || "NORMAL",
    publishAt,
    publishedAt: status === "PUBLISHED" ? new Date() : null,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    status,
    readBy: [],
  });

  if (announcement.status === "PUBLISHED") {
    await publishNotificationsAndSocket(announcement, user);
  }

  await recordAuditLog({
    organizationId: String(user.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "ANNOUNCEMENT_CREATED",
    entityType: "ANNOUNCEMENT",
    entityId: String(announcement._id),
    summary: `Created announcement ${announcement.title} with status ${announcement.status}`,
  });

  return announcement.toObject();
}

export async function updateAnnouncement(user: any, id: string, payload: any) {
  if (!isAdminRole(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(announcement.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  const allowedFields = [
    "title",
    "message",
    "priority",
    "audienceType",
    "departmentId",
    "teamId",
    "role",
    "employmentType",
    "targetUserId",
    "publishAt",
    "expiresAt",
    "status",
  ];

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      (announcement as any)[field] = payload[field];
    }
  }

  if (payload.publishAt) {
    announcement.publishAt = new Date(payload.publishAt);
  }

  await announcement.save();

  await recordAuditLog({
    organizationId: String(announcement.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "ANNOUNCEMENT_UPDATED",
    entityType: "ANNOUNCEMENT",
    entityId: String(announcement._id),
    summary: `Updated announcement ${announcement.title}`,
  });

  return announcement.toObject();
}

export async function publishAnnouncement(user: any, id: string) {
  if (!isAdminRole(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(announcement.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  announcement.status = "PUBLISHED";
  announcement.publishAt = new Date();
  announcement.publishedAt = new Date();
  await announcement.save();

  await publishNotificationsAndSocket(announcement, user);

  await recordAuditLog({
    organizationId: String(announcement.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "ANNOUNCEMENT_PUBLISHED",
    entityType: "ANNOUNCEMENT",
    entityId: String(announcement._id),
    summary: `Published announcement ${announcement.title}`,
  });

  return announcement.toObject();
}

export async function scheduleAnnouncement(user: any, id: string, publishAt: string | Date) {
  if (!isAdminRole(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(announcement.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  const scheduledDate = new Date(publishAt);
  if (isNaN(scheduledDate.getTime())) {
    throw new Error("INVALID_SCHEDULE_DATE");
  }

  announcement.status = "SCHEDULED";
  announcement.publishAt = scheduledDate;
  await announcement.save();

  await recordAuditLog({
    organizationId: String(announcement.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "ANNOUNCEMENT_SCHEDULED",
    entityType: "ANNOUNCEMENT",
    entityId: String(announcement._id),
    summary: `Scheduled announcement ${announcement.title} for ${scheduledDate.toISOString()}`,
  });

  return announcement.toObject();
}

export async function archiveAnnouncement(user: any, id: string) {
  if (!isAdminRole(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(announcement.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  announcement.status = "ARCHIVED";
  announcement.archivedAt = new Date();
  announcement.archivedBy = user._id || user.id;
  await announcement.save();

  await recordAuditLog({
    organizationId: String(announcement.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "ANNOUNCEMENT_ARCHIVED",
    entityType: "ANNOUNCEMENT",
    entityId: String(announcement._id),
    summary: `Archived announcement ${announcement.title}`,
  });

  return announcement.toObject();
}

export async function deleteAnnouncement(user: any, id: string) {
  if (!isAdminRole(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(announcement.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  await Announcement.findByIdAndDelete(id);

  await recordAuditLog({
    organizationId: String(announcement.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "ANNOUNCEMENT_DELETED",
    entityType: "ANNOUNCEMENT",
    entityId: String(announcement._id),
    summary: `Deleted announcement ${announcement.title}`,
  });

  return { success: true };
}

export async function getAnnouncementById(user: any, id: string) {
  const announcement = await Announcement.findById(id)
    .populate("createdBy", "fullName email role")
    .lean();

  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");

  // Multi-tenant check
  if (user.role !== "SUPER_ADMIN" && String(announcement.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // If Admin or Super Admin, can view any within org
  if (isAdminRole(user.role)) {
    return announcement;
  }

  // For regular users (Employee, Manager, HR), must be PUBLISHED, publishAt <= now, not archived
  if (announcement.status !== "PUBLISHED") {
    throw new Error("FORBIDDEN");
  }

  if (new Date(announcement.publishAt).getTime() > Date.now()) {
    throw new Error("FORBIDDEN");
  }

  // Check audience match
  const userId = String(user._id || user.id);
  const matchesAudience =
    announcement.audienceType === "ALL" ||
    (announcement.audienceType === "DEPARTMENT" && String(announcement.departmentId) === String(user.departmentId)) ||
    (announcement.audienceType === "TEAM" && String(announcement.teamId) === String(user.teamId)) ||
    (announcement.audienceType === "ROLE" && announcement.role === user.role) ||
    (announcement.audienceType === "EMPLOYMENT_TYPE" && announcement.employmentType === user.employmentType) ||
    (announcement.audienceType === "USER" && String(announcement.targetUserId) === userId);

  if (!matchesAudience) {
    throw new Error("FORBIDDEN");
  }

  return announcement;
}

export async function listAnnouncements(
  user: any,
  opts: { skip?: number; limit?: number; status?: string; audienceType?: string } = {}
) {
  const skip = opts.skip || 0;
  const limit = opts.limit || 20;

  let query: any;

  if (user.role === "SUPER_ADMIN") {
    query = {};
    if (opts.status) query.status = opts.status;
  } else if (user.role === "ADMIN") {
    // Admin sees all announcements for this tenant (or filtered by status)
    query = { organizationId: user.organizationId };
    if (opts.status) {
      query.status = opts.status;
    }
    if (opts.audienceType) {
      query.audienceType = opts.audienceType;
    }
  } else {
    // Regular employees, HR, Managers -> strictly audience-filtered published announcements
    query = buildUserAudienceQuery(user);
  }

  const items = await Announcement.find(query)
    .sort({ publishAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("createdBy", "fullName email role")
    .lean();

  const total = await Announcement.countDocuments(query);
  return { items, total };
}

export async function getUnreadAnnouncementCount(user: any): Promise<number> {
  const userId = user._id || user.id;
  const userObjectId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;

  let query: any;
  if (user.role === "SUPER_ADMIN") {
    query = { readBy: { $ne: userObjectId } };
  } else if (user.role === "ADMIN") {
    query = {
      organizationId: user.organizationId,
      status: "PUBLISHED",
      publishAt: { $lte: new Date() },
      readBy: { $ne: userObjectId },
    };
  } else {
    query = {
      ...buildUserAudienceQuery(user),
      readBy: { $ne: userObjectId },
    };
  }

  return await Announcement.countDocuments(query);
}

export async function markAnnouncementRead(announcementId: string, userId: string, user?: any) {
  const announcement = await Announcement.findById(announcementId);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");

  if (user) {
    if (user.role !== "SUPER_ADMIN" && String(announcement.organizationId) !== String(user.organizationId)) {
      throw new Error("FORBIDDEN");
    }

    if (!isAdminRole(user.role)) {
      if (announcement.status !== "PUBLISHED" || new Date(announcement.publishAt).getTime() > Date.now()) {
        throw new Error("FORBIDDEN");
      }
      const matchesAudience =
        announcement.audienceType === "ALL" ||
        (announcement.audienceType === "DEPARTMENT" && String(announcement.departmentId) === String(user.departmentId)) ||
        (announcement.audienceType === "TEAM" && String(announcement.teamId) === String(user.teamId)) ||
        (announcement.audienceType === "ROLE" && announcement.role === user.role) ||
        (announcement.audienceType === "EMPLOYMENT_TYPE" && announcement.employmentType === user.employmentType) ||
        (announcement.audienceType === "USER" && String(announcement.targetUserId) === String(userId));

      if (!matchesAudience) {
        throw new Error("FORBIDDEN");
      }
    }
  }

  const userObjectId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;

  if (!announcement.readBy.some((r) => String(r) === String(userId))) {
    announcement.readBy.push(userObjectId as any);
    await announcement.save();
  }

  return announcement.toObject();
}

async function publishNotificationsAndSocket(announcement: any, creator: any) {
  try {
    const query: Record<string, unknown> = {
      organizationId: announcement.organizationId,
      status: "ACTIVE",
    };

    if (announcement.audienceType === "DEPARTMENT" && announcement.departmentId) {
      query.departmentId = announcement.departmentId;
    } else if (announcement.audienceType === "TEAM" && announcement.teamId) {
      query.teamId = announcement.teamId;
    } else if (announcement.audienceType === "ROLE" && announcement.role) {
      query.role = announcement.role;
    } else if (announcement.audienceType === "EMPLOYMENT_TYPE" && announcement.employmentType) {
      query.employmentType = announcement.employmentType;
    } else if (announcement.audienceType === "USER" && announcement.targetUserId) {
      query._id = announcement.targetUserId;
    }

    const targetUsers = await User.find(query).select("_id").lean();

    for (const u of targetUsers) {
      await createNotification({
        recipientId: String(u._id),
        organizationId: String(announcement.organizationId),
        title: `Announcement: ${announcement.title}`,
        message:
          announcement.message.length > 100
            ? `${announcement.message.substring(0, 97)}...`
            : announcement.message,
        type: "ANNOUNCEMENT",
        entityId: String(announcement._id),
      }).catch(() => {});
    }

    // Socket.IO realtime emission if active
    try {
      const io = getSocket();
      const payload = {
        announcementId: announcement.announcementId,
        _id: String(announcement._id),
        title: announcement.title,
        message: announcement.message,
        priority: announcement.priority,
        audienceType: announcement.audienceType,
        publishAt: announcement.publishAt,
        createdAt: announcement.createdAt,
      };

      if (announcement.audienceType === "ALL") {
        io.to(`org:${String(announcement.organizationId)}`).emit("announcement:published", payload);
      } else if (announcement.audienceType === "DEPARTMENT" && announcement.departmentId) {
        io.to(`dept:${String(announcement.departmentId)}`).emit("announcement:published", payload);
      } else if (announcement.audienceType === "TEAM" && announcement.teamId) {
        io.to(`team:${String(announcement.teamId)}`).emit("announcement:published", payload);
      } else if (announcement.audienceType === "USER" && announcement.targetUserId) {
        io.to(`user:${String(announcement.targetUserId)}`).emit("announcement:published", payload);
      } else {
        for (const u of targetUsers) {
          io.to(`user:${String(u._id)}`).emit("announcement:published", payload);
        }
      }
    } catch (sockErr) {
      logger.debug("Socket emission skipped or failed for announcement", { error: (sockErr as Error)?.message });
    }
  } catch (err) {
    logger.error("Error publishing notifications for announcement", { error: (err as Error)?.message });
  }
}
