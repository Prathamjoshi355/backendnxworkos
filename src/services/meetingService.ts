import Meeting from "../models/Meeting";
import User from "../models/User";
import { createNotification } from "./notificationService";
import { recordAuditLog } from "./auditLogService";
import {
  emitMeetingCreated,
  emitMeetingUpdated,
  emitMeetingCancelled,
  emitMeetingParticipantAdded,
  emitMeetingParticipantRemoved,
  emitMeetingRsvpUpdated,
} from "../lib/socketEmitters";

export async function scheduleMeeting(organizer: any, payload: any) {
  const orgId = organizer.organizationId || payload.organizationId;
  if (!orgId) throw new Error("ORGANIZATION_ID_REQUIRED");

  const title = String(payload.title || "").trim();
  if (!title) throw new Error("TITLE_REQUIRED");

  const date = new Date(payload.date);
  if (isNaN(date.getTime())) throw new Error("INVALID_MEETING_DATE");

  if (!payload.startTime || !payload.endTime) {
    throw new Error("START_END_TIME_REQUIRED");
  }

  const count = await Meeting.countDocuments({ organizationId: orgId });
  const meetingId = `MTG-${String(count + 1).padStart(4, "0")}`;

  const orgUserId = String(organizer._id || organizer.id);
  const rawParticipants = Array.isArray(payload.participants) ? payload.participants : [];

  const participantMap = new Map<string, string>();
  // Organizer is accepted by default
  participantMap.set(orgUserId, "ACCEPTED");

  for (const p of rawParticipants) {
    const pid = typeof p === "string" ? p : String(p.userId?._id || p.userId || p.id || "");
    if (pid && !participantMap.has(pid)) {
      // Validate participant belongs to organization if user doc exists
      const userDoc = await User.findById(pid).select("organizationId status").lean();
      if (userDoc) {
        if (organizer.role !== "SUPER_ADMIN" && String(userDoc.organizationId) !== String(orgId)) {
          throw new Error("INVALID_PARTICIPANT_ORGANIZATION");
        }
      }
      participantMap.set(pid, typeof p === "object" && p.responseStatus ? p.responseStatus : "PENDING");
    }
  }

  const participants = Array.from(participantMap.entries()).map(([userId, responseStatus]) => ({
    userId,
    responseStatus: responseStatus as any,
  }));

  const meeting = await Meeting.create({
    meetingId,
    organizationId: orgId,
    departmentId: payload.departmentId || organizer.departmentId || null,
    teamId: payload.teamId || organizer.teamId || null,
    title,
    description: payload.description || null,
    organizerId: orgUserId,
    participants,
    meetingType: payload.meetingType || "ONLINE",
    date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    location: payload.location || null,
    meetingLink: payload.meetingLink || null,
    status: payload.status || "SCHEDULED",
    notes: payload.notes || null,
  });

  const meetingObj = meeting.toObject();

  // Real-time socket emission
  emitMeetingCreated(meetingObj, String(orgId));

  // Notify participants
  for (const p of participants) {
    if (String(p.userId) !== orgUserId) {
      await createNotification({
        recipientId: String(p.userId),
        organizationId: String(orgId),
        title: "New Meeting Scheduled",
        message: `You are invited to "${meeting.title}" on ${date.toISOString().split("T")[0]} at ${payload.startTime}.`,
        type: "MEETING",
        entityId: String(meeting._id),
      }).catch(() => {});
    }
  }

  await recordAuditLog({
    organizationId: String(orgId),
    actorId: orgUserId,
    actorRole: organizer.role,
    action: "MEETING_SCHEDULED",
    entityType: "MEETING",
    entityId: String(meeting._id),
    summary: `Scheduled meeting ${meeting.title} (${meetingId})`,
  });

  return meetingObj;
}

export async function listMeetings(
  user: any,
  filter: Record<string, unknown> = {},
  opts: { skip?: number; limit?: number; startDate?: string; endDate?: string } = {}
) {
  const skip = opts.skip || 0;
  const limit = opts.limit || 50;

  const queryFilter: Record<string, unknown> = { ...filter };

  // Enforce organization scoping
  if (user.role !== "SUPER_ADMIN") {
    queryFilter.organizationId = user.organizationId;
  }

  // Enforce role-based participant visibility for employees
  if (["EMPLOYEE", "INTERN", "DESIGNER", "SALES_EXECUTIVE"].includes(user.role)) {
    queryFilter.$or = [
      { organizerId: user._id },
      { "participants.userId": user._id },
    ];
  }

  // Support date range queries for calendar integration
  if (opts.startDate || opts.endDate) {
    const dateQuery: Record<string, any> = {};
    if (opts.startDate) dateQuery.$gte = new Date(opts.startDate);
    if (opts.endDate) dateQuery.$lte = new Date(opts.endDate);
    queryFilter.date = dateQuery;
  }

  const items = await Meeting.find(queryFilter)
    .sort({ date: 1, startTime: 1 })
    .skip(skip)
    .limit(limit)
    .populate("organizerId", "fullName email employeeId role designation")
    .populate("participants.userId", "fullName email employeeId role designation")
    .populate("departmentId", "name code")
    .populate("teamId", "name code")
    .lean();

  const total = await Meeting.countDocuments(queryFilter);
  return { items, total };
}

export async function getMeetingById(meetingId: string, user: any) {
  const meeting = await Meeting.findById(meetingId)
    .populate("organizerId", "fullName email employeeId role designation")
    .populate("participants.userId", "fullName email employeeId role designation")
    .populate("departmentId", "name code")
    .populate("teamId", "name code")
    .lean();

  if (!meeting) throw new Error("MEETING_NOT_FOUND");

  // Enforce organization isolation
  if (user.role !== "SUPER_ADMIN" && String(meeting.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // Enforce employee visibility
  if (["EMPLOYEE", "INTERN", "DESIGNER", "SALES_EXECUTIVE"].includes(user.role)) {
    const isOrganizer = String((meeting.organizerId as any)?._id || meeting.organizerId) === String(user._id);
    const isParticipant = (meeting.participants || []).some(
      (p: any) => String(p.userId?._id || p.userId) === String(user._id)
    );
    if (!isOrganizer && !isParticipant) {
      throw new Error("FORBIDDEN");
    }
  }

  return meeting;
}

export async function updateMeeting(meetingId: string, user: any, payload: any) {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw new Error("MEETING_NOT_FOUND");

  // Enforce organization isolation
  if (user.role !== "SUPER_ADMIN" && String(meeting.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // Enforce authorization
  const isSuper = user.role === "SUPER_ADMIN";
  const isAdmin = user.role === "ADMIN";
  const isOrganizer = String(meeting.organizerId) === String(user._id || user.id);
  const isManager = user.role === "MANAGER" || user.role === "TEAM_LEADER";

  if (!isSuper && !isAdmin && !isOrganizer && !isManager) {
    throw new Error("FORBIDDEN");
  }

  // If meeting is cancelled, prevent updating details unless reactivating
  if (meeting.status === "CANCELLED" && payload.status === undefined) {
    throw new Error("CANNOT_MODIFY_CANCELLED_MEETING");
  }

  const oldStatus = meeting.status;
  if (payload.title) meeting.title = payload.title;
  if (payload.description !== undefined) meeting.description = payload.description;
  if (payload.date) meeting.date = new Date(payload.date);
  if (payload.startTime) meeting.startTime = payload.startTime;
  if (payload.endTime) meeting.endTime = payload.endTime;
  if (payload.meetingType) meeting.meetingType = payload.meetingType;
  if (payload.status) meeting.status = payload.status;
  if (payload.location !== undefined) meeting.location = payload.location;
  if (payload.meetingLink !== undefined) meeting.meetingLink = payload.meetingLink;
  if (payload.notes !== undefined) meeting.notes = payload.notes;
  if (payload.departmentId !== undefined) meeting.departmentId = payload.departmentId;
  if (payload.teamId !== undefined) meeting.teamId = payload.teamId;

  if (Array.isArray(payload.participants)) {
    const existingMap = new Map(meeting.participants.map((p) => [String(p.userId), p.responseStatus]));
    meeting.participants = payload.participants.map((p: any) => {
      const uid = typeof p === "string" ? p : String(p.userId?._id || p.userId || p.id || "");
      const existingStatus = existingMap.get(uid);
      return {
        userId: uid as any,
        responseStatus: existingStatus || (typeof p === "object" && p.responseStatus ? p.responseStatus : "PENDING"),
      };
    });
  }

  await meeting.save();

  const meetingObj = meeting.toObject();

  // Socket update
  emitMeetingUpdated(meetingObj, String(meeting.organizationId));

  if (payload.status === "CANCELLED" && oldStatus !== "CANCELLED") {
    emitMeetingCancelled(meetingObj, String(meeting.organizationId));
    for (const p of meeting.participants) {
      await createNotification({
        recipientId: String(p.userId),
        organizationId: String(meeting.organizationId),
        title: "Meeting Cancelled",
        message: `Meeting "${meeting.title}" has been cancelled.`,
        type: "MEETING",
        entityId: String(meeting._id),
      }).catch(() => {});
    }
  }

  await recordAuditLog({
    organizationId: String(meeting.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "MEETING_UPDATED",
    entityType: "MEETING",
    entityId: String(meeting._id),
    summary: `Updated meeting ${meeting.title}`,
  });

  return meetingObj;
}

export async function cancelMeeting(meetingId: string, user: any, reason?: string) {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw new Error("MEETING_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(meeting.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  const isSuper = user.role === "SUPER_ADMIN";
  const isAdmin = user.role === "ADMIN";
  const isOrganizer = String(meeting.organizerId) === String(user._id || user.id);
  const isManager = user.role === "MANAGER" || user.role === "TEAM_LEADER";

  if (!isSuper && !isAdmin && !isOrganizer && !isManager) {
    throw new Error("FORBIDDEN");
  }

  meeting.status = "CANCELLED";
  if (reason) {
    meeting.notes = meeting.notes ? `${meeting.notes}\nCancellation Reason: ${reason}` : `Cancellation Reason: ${reason}`;
  }
  await meeting.save();

  const meetingObj = meeting.toObject();
  emitMeetingCancelled(meetingObj, String(meeting.organizationId));

  for (const p of meeting.participants) {
    await createNotification({
      recipientId: String(p.userId),
      organizationId: String(meeting.organizationId),
      title: "Meeting Cancelled",
      message: `Meeting "${meeting.title}" has been cancelled.${reason ? ` Reason: ${reason}` : ""}`,
      type: "MEETING",
      entityId: String(meeting._id),
    }).catch(() => {});
  }

  await recordAuditLog({
    organizationId: String(meeting.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "MEETING_CANCELLED",
    entityType: "MEETING",
    entityId: String(meeting._id),
    summary: `Cancelled meeting ${meeting.title}`,
  });

  return meetingObj;
}

export async function updateParticipantResponse(meetingId: string, userId: string, responseStatus: string) {
  const validStatuses = ["ACCEPTED", "DECLINED", "TENTATIVE", "PENDING"];
  if (!validStatuses.includes(responseStatus)) {
    throw new Error("INVALID_RESPONSE_STATUS");
  }

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw new Error("MEETING_NOT_FOUND");

  const participant = meeting.participants.find((p) => String(p.userId) === String(userId));
  if (participant) {
    participant.responseStatus = responseStatus as any;
  } else {
    meeting.participants.push({ userId: userId as any, responseStatus: responseStatus as any });
  }

  await meeting.save();
  const meetingObj = meeting.toObject();

  emitMeetingRsvpUpdated(meetingObj, userId, responseStatus, String(meeting.organizationId));
  return meetingObj;
}

export async function addMeetingParticipants(meetingId: string, participantIds: string[], user: any) {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw new Error("MEETING_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(meeting.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  const existingSet = new Set(meeting.participants.map((p) => String(p.userId)));
  for (const id of participantIds) {
    if (!existingSet.has(id)) {
      meeting.participants.push({ userId: id as any, responseStatus: "PENDING" });
      emitMeetingParticipantAdded(meeting.toObject(), id, String(meeting.organizationId));
      await createNotification({
        recipientId: id,
        organizationId: String(meeting.organizationId),
        title: "Added to Meeting",
        message: `You were invited to "${meeting.title}".`,
        type: "MEETING",
        entityId: String(meeting._id),
      }).catch(() => {});
    }
  }

  await meeting.save();
  return meeting.toObject();
}

export async function removeMeetingParticipant(meetingId: string, participantId: string, user: any) {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw new Error("MEETING_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(meeting.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  meeting.participants = meeting.participants.filter((p) => String(p.userId) !== String(participantId));
  await meeting.save();

  emitMeetingParticipantRemoved(meeting.toObject(), participantId, String(meeting.organizationId));
  return meeting.toObject();
}

