export interface IMessageAttachment {
  attachmentId: string;
  originalName: string;
  storageKey: string;
  url?: string;
  mimeType: string;
  size: number;
  category: "IMAGE" | "DOCUMENT" | "SPREADSHEET" | "PRESENTATION" | "ARCHIVE" | "OTHER";
  dimensions?: { width: number; height: number };
  uploadedAt: Date;
}

export type MessageStatus = "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

import mongoose, { Schema, Document, Types } from "mongoose";

export interface IMessage extends Document {
  messageId: string;
  conversationId: Types.ObjectId;
  organizationId: Types.ObjectId;
  senderId: Types.ObjectId;
  body: string;
  messageType: "TEXT" | "SYSTEM" | "ATTACHMENT";
  status: MessageStatus;
  attachments?: IMessageAttachment[];
  replyTo?: {
    messageId: string;
    senderId?: Types.ObjectId;
    body: string;
  };
  deliveredTo?: {
    userId: Types.ObjectId;
    deliveredAt: Date;
  }[];
  editedAt?: Date | null;
  readBy: {
    userId: Types.ObjectId;
    readAt: Date;
  }[];
  isEdited: boolean;
  isDeleted: boolean;
  clientMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    messageType: {
      type: String,
      enum: ["TEXT", "SYSTEM", "ATTACHMENT"],
      default: "TEXT",
    },
    status: {
      type: String,
      enum: ["SENDING", "SENT", "DELIVERED", "READ", "FAILED"],
      default: "SENT",
      index: true,
    },
    attachments: [
      {
        attachmentId: { type: String, required: true },
        originalName: { type: String, required: true },
        storageKey: { type: String, required: true },
        url: { type: String },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
        category: { type: String, enum: ["IMAGE", "DOCUMENT", "SPREADSHEET", "PRESENTATION", "ARCHIVE", "OTHER"], default: "OTHER" },
        dimensions: {
          width: { type: Number },
          height: { type: Number },
        },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    replyTo: {
      messageId: { type: String },
      senderId: { type: Schema.Types.ObjectId, ref: "User" },
      body: { type: String },
    },
    deliveredTo: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        deliveredAt: { type: Date, default: Date.now },
      },
    ],
    editedAt: {
      type: Date,
      default: null,
    },
    readBy: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        readAt: { type: Date, default: Date.now },
      },
    ],
    isEdited: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    clientMessageId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ organizationId: 1, conversationId: 1 });

const Message =
  mongoose.models.Message || mongoose.model<IMessage>("Message", MessageSchema);

export default Message;
