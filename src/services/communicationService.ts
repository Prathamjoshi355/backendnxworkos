import storageProvider from "./storageService";
import { validateUploadFile } from "../utils/fileSecurity";
import mongoose, { Types } from "mongoose";
import Conversation, { IConversation } from "../models/Conversation";
import Message, { IMessage } from "../models/Message";
import User from "../models/User";
import {
  emitMessageCreated,
  emitMessageUpdated,
  emitMessageDeleted,
  emitMessageRead,
  emitConversationCreated,
  emitConversationUpdated,
} from "../lib/socketEmitters";
import { createNotification } from "./notificationService";
import AuditLog from "../models/AuditLog";

function generateSequenceCode(prefix: string, count: number): string {
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Get or create a 1-on-1 direct conversation between authenticated user and a recipient
 */
export async function getOrCreateDirectConversation(
  currentUser: any,
  recipientId: string | Types.ObjectId
) {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_ID_REQUIRED");
  }
  if (!recipientId) {
    throw new Error("RECIPIENT_ID_REQUIRED");
  }

  const currentUserId = String(currentUser._id || currentUser.id);
  const recipientUserId = String(recipientId);

  if (currentUserId === recipientUserId) {
    throw new Error("CANNOT_MESSAGE_SELF");
  }

  // Verify recipient exists, is active, and is in the same organization
  const recipient = await User.findOne({
    _id: recipientUserId,
    organizationId: currentUser.organizationId,
    status: "ACTIVE",
  });

  if (!recipient) {
    throw new Error("RECIPIENT_NOT_FOUND_OR_INACTIVE");
  }

  // Check if direct conversation already exists
  let conversation = await Conversation.findOne({
    organizationId: currentUser.organizationId,
    type: "DIRECT",
    participants: {
      $all: [
        new mongoose.Types.ObjectId(currentUserId),
        new mongoose.Types.ObjectId(recipientUserId),
      ],
      $size: 2,
    },
  }).populate("participants", "fullName email role designation departmentName department");

  if (!conversation) {
    const totalCount = await Conversation.countDocuments({
      organizationId: currentUser.organizationId,
    });
    const conversationId = generateSequenceCode("CONV", totalCount);

    conversation = await Conversation.create({
      conversationId,
      organizationId: currentUser.organizationId,
      type: "DIRECT",
      participants: [
        new mongoose.Types.ObjectId(currentUserId),
        new mongoose.Types.ObjectId(recipientUserId),
      ],
      createdBy: new mongoose.Types.ObjectId(currentUserId),
      lastMessageAt: new Date(),
      unreadCounts: new Map<string, number>([
        [currentUserId, 0],
        [recipientUserId, 0],
      ]),
    });

    conversation = await Conversation.findById(conversation._id).populate(
      "participants",
      "fullName email role designation departmentName department"
    );

    emitConversationCreated(conversation, currentUser.organizationId);
  }

  return conversation;
}

/**
 * Create a new group conversation
 */
export async function createGroupConversation(
  currentUser: any,
  data: {
    name: string;
    description?: string;
    groupImage?: string;
    participantIds: string[];
    divisionId?: string;
    departmentId?: string;
    teamId?: string;
    projectId?: string;
    meetingId?: string;
  }
) {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_ID_REQUIRED");
  }
  if (!data.name || !data.name.trim()) {
    throw new Error("GROUP_NAME_REQUIRED");
  }

  const currentUserId = String(currentUser._id || currentUser.id);
  const uniqueParticipantIds = Array.from(
    new Set([...(data.participantIds || []).map(String), currentUserId])
  );

  if (uniqueParticipantIds.length < 2) {
    throw new Error("MINIMUM_PARTICIPANTS_REQUIRED");
  }

  // Verify all participants belong to the organization
  const validUsers = await User.find({
    _id: { $in: uniqueParticipantIds },
    organizationId: currentUser.organizationId,
    status: "ACTIVE",
  });

  if (validUsers.length !== uniqueParticipantIds.length) {
    throw new Error("INVALID_PARTICIPANT_ORGANIZATION");
  }

  const totalCount = await Conversation.countDocuments({
    organizationId: currentUser.organizationId,
  });
  const conversationId = generateSequenceCode("CONV", totalCount);

  const unreadMap = new Map<string, number>();
  for (const pId of uniqueParticipantIds) {
    unreadMap.set(pId, 0);
  }

  let conversation = await Conversation.create({
    conversationId,
    organizationId: currentUser.organizationId,
    type: data.projectId ? "PROJECT" : data.meetingId ? "MEETING" : "GROUP",
    name: data.name.trim(),
    description: data.description?.trim(),
    participants: uniqueParticipantIds.map((id) => new mongoose.Types.ObjectId(id)),
    createdBy: new mongoose.Types.ObjectId(currentUserId),
    admins: [new mongoose.Types.ObjectId(currentUserId)],
    lastMessageAt: new Date(),
    unreadCounts: unreadMap,
    divisionId: data.divisionId ? new mongoose.Types.ObjectId(data.divisionId) : undefined,
    departmentId: data.departmentId,
    teamId: data.teamId,
    groupImage: data.groupImage,
    projectId: data.projectId ? new mongoose.Types.ObjectId(data.projectId) : undefined,
    meetingId: data.meetingId ? new mongoose.Types.ObjectId(data.meetingId) : undefined,
  });

  conversation = await Conversation.findById(conversation._id).populate(
    "participants",
    "fullName email role designation departmentName department"
  );

  emitConversationCreated(conversation, currentUser.organizationId);

  // Notify other participants
  for (const user of validUsers) {
    if (String(user._id) !== currentUserId) {
      createNotification({
        organizationId: currentUser.organizationId ? String(currentUser.organizationId) : undefined,
        recipientId: String(user._id),
        title: "Added to Group Conversation",
        message: `${currentUser.fullName || "A team member"} added you to "${data.name.trim()}".`,
        type: "GENERAL",
        entityType: "CONVERSATION",
        entityId: String(conversation._id),
      }).catch(() => {});
    }
  }

  return conversation;
}

/**
 * List conversations accessible to the user
 */
export async function listConversations(
  currentUser: any,
  query: {
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_ID_REQUIRED");
  }

  const currentUserId = String(currentUser._id || currentUser.id);
  const filter: any = {
    organizationId: currentUser.organizationId,
    isArchived: false,
  };

  if (currentUser.role !== "SUPER_ADMIN") {
    filter.participants = new mongoose.Types.ObjectId(currentUserId);
  }

  if (query.type && query.type !== "ALL") {
    filter.type = query.type;
  }

  if (query.search && query.search.trim()) {
    const searchRegex = new RegExp(query.search.trim(), "i");
    filter.$or = [
      { name: searchRegex },
      { conversationId: searchRegex },
      { "lastMessage.body": searchRegex },
    ];
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.max(1, Math.min(100, query.limit || 50));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("participants", "fullName email role designation departmentName department")
      .populate("lastMessage.senderId", "fullName email role")
      .lean(),
    Conversation.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

/**
 * Get single conversation by ID with membership check
 */
export async function getConversationById(
  currentUser: any,
  conversationId: string | Types.ObjectId
) {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_ID_REQUIRED");
  }

  const isObjectId = mongoose.Types.ObjectId.isValid(String(conversationId));
  const query: any = {
    organizationId: currentUser.organizationId,
    ...(isObjectId
      ? { _id: conversationId }
      : { conversationId: String(conversationId) }),
  };

  const conversation = await Conversation.findOne(query).populate(
    "participants",
    "fullName email role designation departmentName department"
  );

  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const currentUserId = String(currentUser._id || currentUser.id);
  const isParticipant = conversation.participants.some(
    (p: any) => String(p._id || p) === currentUserId
  );

  if (!isParticipant && currentUser.role !== "SUPER_ADMIN") {
    throw new Error("FORBIDDEN");
  }

  return conversation;
}

/**
 * Send message inside a conversation
 */
export async function sendMessage(
  currentUser: any,
  conversationId: string | Types.ObjectId,
  data: {
    body: string;
    clientMessageId?: string;
    messageType?: "TEXT" | "SYSTEM" | "ATTACHMENT";
    attachments?: Array<{
      attachmentId?: string;
      originalName: string;
      storageKey: string;
      url?: string;
      mimeType: string;
      size: number;
      category?: "IMAGE" | "DOCUMENT" | "SPREADSHEET" | "PRESENTATION" | "ARCHIVE" | "OTHER";
      dimensions?: { width: number; height: number };
    }>;
    replyTo?: {
      messageId: string;
      senderId?: string;
      body: string;
    };
  }
) {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_ID_REQUIRED");
  }
  if (!data.body || !data.body.trim()) {
    throw new Error("MESSAGE_BODY_REQUIRED");
  }

  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);

  // Idempotency deduplication check
  if (data.clientMessageId) {
    const existingMessage = await Message.findOne({
      conversationId: conversation._id,
      clientMessageId: data.clientMessageId,
    }).populate("senderId", "fullName email role");

    if (existingMessage) {
      return existingMessage;
    }
  }

  const totalCount = await Message.countDocuments({
    organizationId: currentUser.organizationId,
  });
  const messageId = generateSequenceCode("MSG", totalCount);

  const message = await Message.create({
    messageId,
    conversationId: conversation._id,
    organizationId: currentUser.organizationId,
    senderId: new mongoose.Types.ObjectId(currentUserId),
    body: data.body.trim(),
    messageType: data.attachments && data.attachments.length > 0 ? "ATTACHMENT" : (data.messageType || "TEXT"),
    status: "SENT",
    attachments: data.attachments?.map((a) => ({
      ...a,
      attachmentId: a.attachmentId || generateSequenceCode("ATT", Math.floor(Math.random() * 10000)),
      uploadedAt: new Date(),
    })) || [],
    replyTo: data.replyTo ? {
      messageId: data.replyTo.messageId,
      senderId: data.replyTo.senderId ? new mongoose.Types.ObjectId(data.replyTo.senderId) : undefined,
      body: data.replyTo.body,
    } : undefined,
    clientMessageId: data.clientMessageId,
    readBy: [{ userId: new mongoose.Types.ObjectId(currentUserId), readAt: new Date() }],
    deliveredTo: [],
  });

  const populatedMessage = await Message.findById(message._id).populate(
    "senderId",
    "fullName email role designation"
  );

  // Update conversation lastMessage, lastMessageAt, and increment unread counts
  conversation.lastMessage = {
    messageId: message.messageId,
    senderId: new mongoose.Types.ObjectId(currentUserId),
    body: data.body.trim(),
    createdAt: message.createdAt,
  };
  conversation.lastMessageAt = message.createdAt;

  if (!conversation.unreadCounts) {
    conversation.unreadCounts = new Map<string, number>();
  }

  for (const p of conversation.participants) {
    const pId = String(p._id || p);
    if (pId !== currentUserId) {
      const currentCount = conversation.unreadCounts.get(pId) || 0;
      conversation.unreadCounts.set(pId, currentCount + 1);
    }
  }

  await conversation.save();

  // Real-time broadcast
  emitMessageCreated(populatedMessage, conversation, currentUser.organizationId);
  emitConversationUpdated(conversation, currentUser.organizationId);

  // Notifications for offline/other participants
  const isDirect = conversation.type === "DIRECT";
  const title = isDirect
    ? `New message from ${currentUser.fullName || "Collaborator"}`
    : `New message in "${conversation.name || "Group"}"`;

  for (const p of conversation.participants) {
    const pId = String(p._id || p);
    if (pId !== currentUserId) {
      createNotification({
        organizationId: currentUser.organizationId ? String(currentUser.organizationId) : undefined,
        recipientId: pId,
        title,
        message: data.body.trim().length > 60
          ? `${data.body.trim().substring(0, 57)}...`
          : data.body.trim(),
        type: "GENERAL",
        entityType: "MESSAGE",
        entityId: String(message._id),
      }).catch(() => {});
    }
  }

  return populatedMessage;
}

/**
 * List messages in a conversation
 */
export async function listMessages(
  currentUser: any,
  conversationId: string | Types.ObjectId,
  query: {
    before?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  const conversation = await getConversationById(currentUser, conversationId);

  const filter: any = {
    conversationId: conversation._id,
  };

  if (query.before) {
    filter.createdAt = { $lt: new Date(query.before) };
  }

  const limit = Math.max(1, Math.min(100, query.limit || 50));
  const page = Math.max(1, query.page || 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate("senderId", "fullName email role designation")
      .lean(),
    Message.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

/**
 * Mark all messages in a conversation as read by the user
 */
export async function markConversationRead(
  currentUser: any,
  conversationId: string | Types.ObjectId
) {
  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);

  if (conversation.unreadCounts) {
    conversation.unreadCounts.set(currentUserId, 0);
    await conversation.save();
  }

  // Update messages read receipts
  await Message.updateMany(
    {
      conversationId: conversation._id,
      "readBy.userId": { $ne: new mongoose.Types.ObjectId(currentUserId) },
    },
    {
      $set: { status: "READ" },
      $push: {
        readBy: {
          userId: new mongoose.Types.ObjectId(currentUserId),
          readAt: new Date(),
        },
      },
    }
  );

  emitMessageRead(conversation._id, currentUserId, currentUser.organizationId);
  emitConversationUpdated(conversation, currentUser.organizationId);

  return { success: true, conversationId: conversation._id };
}

/**
 * Edit a message
 */
export async function editMessage(
  currentUser: any,
  messageId: string | Types.ObjectId,
  body: string
) {
  if (!body || !body.trim()) {
    throw new Error("MESSAGE_BODY_REQUIRED");
  }

  const isObjectId = mongoose.Types.ObjectId.isValid(String(messageId));
  const message = await Message.findOne({
    ...(isObjectId ? { _id: messageId } : { messageId: String(messageId) }),
    organizationId: currentUser.organizationId,
  });

  if (!message) {
    throw new Error("MESSAGE_NOT_FOUND");
  }

  const currentUserId = String(currentUser._id || currentUser.id);
  if (String(message.senderId) !== currentUserId) {
    throw new Error("FORBIDDEN");
  }

  if (message.isDeleted) {
    throw new Error("CANNOT_EDIT_DELETED_MESSAGE");
  }

  message.body = body.trim();
  message.isEdited = true;
  await message.save();

  const populated = await Message.findById(message._id).populate(
    "senderId",
    "fullName email role designation"
  );

  emitMessageUpdated(populated, message.conversationId, currentUser.organizationId);

  return populated;
}

/**
 * Soft delete a message
 */
export async function deleteMessage(
  currentUser: any,
  messageId: string | Types.ObjectId
) {
  const isObjectId = mongoose.Types.ObjectId.isValid(String(messageId));
  const message = await Message.findOne({
    ...(isObjectId ? { _id: messageId } : { messageId: String(messageId) }),
    organizationId: currentUser.organizationId,
  });

  if (!message) {
    throw new Error("MESSAGE_NOT_FOUND");
  }

  const currentUserId = String(currentUser._id || currentUser.id);
  const isSender = String(message.senderId) === currentUserId;
  const isAdmin = ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(currentUser.role);

  if (!isSender && !isAdmin) {
    throw new Error("FORBIDDEN");
  }

  message.body = "This message was deleted";
  message.isDeleted = true;
  await message.save();

  emitMessageDeleted(message._id, message.conversationId, currentUser.organizationId);

  return { success: true, messageId: message._id };
}

/**
 * Search active collaborator users in the same organization
 */
export async function searchCollaborators(
  currentUser: any,
  searchQuery: string = ""
) {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_ID_REQUIRED");
  }

  const currentUserId = String(currentUser._id || currentUser.id);
  const filter: any = {
    organizationId: currentUser.organizationId,
    status: "ACTIVE",
    _id: { $ne: new mongoose.Types.ObjectId(currentUserId) },
  };

  if (searchQuery && searchQuery.trim()) {
    const regex = new RegExp(searchQuery.trim(), "i");
    filter.$or = [
      { fullName: regex },
      { email: regex },
      { employeeId: regex },
      { designation: regex },
    ];
  }

  return User.find(filter)
    .select("fullName email employeeId role designation departmentName department")
    .limit(20)
    .lean();
}

/**
 * Add participants to a group conversation
 */
export async function addParticipantsToGroup(
  currentUser: any,
  conversationId: string | Types.ObjectId,
  participantIds: string[]
) {
  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);

  if (conversation.type === "DIRECT") {
    throw new Error("CANNOT_ADD_MEMBERS_TO_DIRECT_CHAT");
  }

  // Only creator, admins, or SUPER_ADMIN / ADMIN can add members
  const isAdminOrCreator =
    String(conversation.createdBy) === currentUserId ||
    (conversation.admins && conversation.admins.some((a: any) => String(a) === currentUserId)) ||
    ["SUPER_ADMIN", "ADMIN"].includes(currentUser.role);

  if (!isAdminOrCreator) {
    throw new Error("FORBIDDEN: Only group administrators can add participants.");
  }

  const validUsers = await User.find({
    _id: { $in: participantIds },
    organizationId: currentUser.organizationId,
    status: "ACTIVE",
  });

  const existingParticipantIds = new Set(conversation.participants.map((p: any) => String(p._id || p)));
  const newlyAdded: any[] = [];

  for (const user of validUsers) {
    const uId = String(user._id);
    if (!existingParticipantIds.has(uId)) {
      conversation.participants.push(user._id);
      if (conversation.unreadCounts) {
        conversation.unreadCounts.set(uId, 0);
      }
      newlyAdded.push(user);
    }
  }

  await conversation.save();

  const populated = await Conversation.findById(conversation._id).populate(
    "participants",
    "fullName email role designation departmentName department"
  );

  const { emitConversationUpdated } = await import("../lib/socketEmitters");
  emitConversationUpdated(populated, currentUser.organizationId);

  return populated;
}

/**
 * Remove a participant from a group conversation
 */
export async function removeParticipantFromGroup(
  currentUser: any,
  conversationId: string | Types.ObjectId,
  participantIdToRemove: string
) {
  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);

  if (conversation.type === "DIRECT") {
    throw new Error("CANNOT_REMOVE_MEMBERS_FROM_DIRECT_CHAT");
  }

  const isAdminOrCreator =
    String(conversation.createdBy) === currentUserId ||
    (conversation.admins && conversation.admins.some((a: any) => String(a) === currentUserId)) ||
    ["SUPER_ADMIN", "ADMIN"].includes(currentUser.role);

  if (!isAdminOrCreator) {
    throw new Error("FORBIDDEN: Only group administrators can remove participants.");
  }

  conversation.participants = conversation.participants.filter(
    (p: any) => String(p._id || p) !== String(participantIdToRemove)
  );

  if (conversation.admins) {
    conversation.admins = conversation.admins.filter(
      (a: any) => String(a) !== String(participantIdToRemove)
    );
  }

  if (conversation.unreadCounts) {
    conversation.unreadCounts.delete(String(participantIdToRemove));
  }

  await conversation.save();

  const populated = await Conversation.findById(conversation._id).populate(
    "participants",
    "fullName email role designation departmentName department"
  );

  const { emitConversationUpdated } = await import("../lib/socketEmitters");
  emitConversationUpdated(populated, currentUser.organizationId);

  return populated;
}

/**
 * Leave a group conversation
 */
export async function leaveGroup(
  currentUser: any,
  conversationId: string | Types.ObjectId
) {
  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);

  if (conversation.type === "DIRECT") {
    throw new Error("CANNOT_LEAVE_DIRECT_CHAT");
  }

  conversation.participants = conversation.participants.filter(
    (p: any) => String(p._id || p) !== currentUserId
  );

  if (conversation.admins) {
    conversation.admins = conversation.admins.filter(
      (a: any) => String(a) !== currentUserId
    );
  }

  if (conversation.unreadCounts) {
    conversation.unreadCounts.delete(currentUserId);
  }

  await conversation.save();

  const populated = await Conversation.findById(conversation._id).populate(
    "participants",
    "fullName email role designation departmentName department"
  );

  const { emitConversationUpdated } = await import("../lib/socketEmitters");
  emitConversationUpdated(populated, currentUser.organizationId);

  return { success: true, conversationId: conversation._id };
}

/**
 * Update group details (name, description, avatar)
 */
export async function updateGroupDetails(
  currentUser: any,
  conversationId: string | Types.ObjectId,
  data: {
    name?: string;
    description?: string;
    groupImage?: string;
  }
) {
  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);

  if (conversation.type === "DIRECT") {
    throw new Error("CANNOT_EDIT_DIRECT_CHAT");
  }

  const isAdminOrCreator =
    String(conversation.createdBy) === currentUserId ||
    (conversation.admins && conversation.admins.some((a: any) => String(a) === currentUserId)) ||
    ["SUPER_ADMIN", "ADMIN"].includes(currentUser.role);

  if (!isAdminOrCreator) {
    throw new Error("FORBIDDEN: Only group administrators can update group details.");
  }

  if (data.name !== undefined) conversation.name = data.name.trim();
  if (data.description !== undefined) (conversation as any).description = data.description?.trim();
  if (data.groupImage !== undefined) (conversation as any).groupImage = data.groupImage;

  await conversation.save();

  const populated = await Conversation.findById(conversation._id).populate(
    "participants",
    "fullName email role designation departmentName department"
  );

  const { emitConversationUpdated } = await import("../lib/socketEmitters");
  emitConversationUpdated(populated, currentUser.organizationId);

  return populated;
}

/**
 * Mark messages in a conversation as delivered to the current user
 */
export async function markMessagesDelivered(
  currentUser: any,
  conversationId: string | Types.ObjectId
) {
  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);
  const now = new Date();

  const result = await Message.updateMany(
    {
      conversationId: conversation._id,
      senderId: { $ne: new mongoose.Types.ObjectId(currentUserId) },
      "deliveredTo.userId": { $ne: new mongoose.Types.ObjectId(currentUserId) },
    },
    {
      $set: { status: "DELIVERED" },
      $push: {
        deliveredTo: {
          userId: new mongoose.Types.ObjectId(currentUserId),
          deliveredAt: now,
        },
      },
    }
  );

  const { emitMessageDelivered } = await import("../lib/socketEmitters");
  emitMessageDelivered("ALL", conversation._id, currentUserId);

  return { success: true, count: result.modifiedCount };
}

/**
 * Securely upload an attachment for a conversation
 */
export async function uploadConversationAttachment(
  currentUser: any,
  conversationId: string | Types.ObjectId,
  file: {
    buffer?: Buffer;
    base64?: string;
    fileName: string;
    mimeType: string;
    fileSize?: number;
  }
) {
  const conversation = await getConversationById(currentUser, conversationId);
  const currentUserId = String(currentUser._id || currentUser.id);

  const buffer = file.buffer || (file.base64 ? Buffer.from(file.base64, "base64") : Buffer.alloc(0));

  if (file.fileSize && file.fileSize > 25 * 1024 * 1024) {
    throw new Error("INVALID_FILE: File size exceeds 25MB limit");
  }

  // Validate file security (size, extension, mime signature)
  const validation = validateUploadFile(buffer, file.fileName, file.mimeType);

  if (!validation.isValid) {
    throw new Error(`INVALID_FILE: ${validation.error}`);
  }

  const uploadResult = await storageProvider.upload({
    buffer,
    fileName: file.fileName,
    mimeType: file.mimeType,
    organizationId: String(currentUser.organizationId),
  });

  // Determine category
  let category: "IMAGE" | "DOCUMENT" | "SPREADSHEET" | "PRESENTATION" | "ARCHIVE" | "OTHER" = "OTHER";
  const mime = file.mimeType.toLowerCase();
  if (mime.startsWith("image/")) {
    category = "IMAGE";
  } else if (mime.includes("pdf") || mime.includes("word") || mime.includes("text")) {
    category = "DOCUMENT";
  } else if (mime.includes("excel") || mime.includes("spreadsheet") || mime.includes("csv")) {
    category = "SPREADSHEET";
  } else if (mime.includes("presentation") || mime.includes("powerpoint")) {
    category = "PRESENTATION";
  } else if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar")) {
    category = "ARCHIVE";
  }

  const attachmentId = generateSequenceCode("ATT", Math.floor(Math.random() * 100000));

  return {
    attachmentId,
    originalName: file.fileName,
    storageKey: uploadResult.storagePath,
    url: uploadResult.fileUrl,
    mimeType: file.mimeType,
    size: uploadResult.fileSize,
    category,
    uploadedAt: new Date(),
  };
}

/**
 * Authorize and obtain secure access to an attachment
 */
export async function getAttachmentAccess(
  currentUser: any,
  conversationId: string | Types.ObjectId,
  attachmentId: string
) {
  // 1. Verify user is currently an authorized participant
  const conversation = await getConversationById(currentUser, conversationId);

  // 2. Find message containing this attachment
  const message = await Message.findOne({
    conversationId: conversation._id,
    "attachments.attachmentId": attachmentId,
  }).lean();

  if (!message) {
    throw new Error("ATTACHMENT_NOT_FOUND");
  }

  const msg = message as any;
  const attachment = msg?.attachments?.find((a: any) => a.attachmentId === attachmentId);
  if (!attachment) {
    throw new Error("ATTACHMENT_NOT_FOUND");
  }

  // Obtain signed download URL with 15-minute expiry
  const signedUrl = storageProvider.getSignedDownloadUrl
    ? await storageProvider.getSignedDownloadUrl(attachment.storageKey, 900)
    : storageProvider.getUrl(attachment.storageKey);

  return {
    attachment,
    signedUrl,
  };
}
