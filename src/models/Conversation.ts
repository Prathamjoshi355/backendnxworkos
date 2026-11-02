import mongoose, { Schema, Document, Types } from "mongoose";

export interface IConversation extends Document {
  conversationId: string;
  organizationId: Types.ObjectId;
  type: "DIRECT" | "GROUP" | "PROJECT" | "MEETING";
  name?: string;
  description?: string;
  groupImage?: string;
  admins?: Types.ObjectId[];
  divisionId?: Types.ObjectId;
  departmentId?: string;
  teamId?: string;
  participants: Types.ObjectId[];
  createdBy: Types.ObjectId;
  lastMessage?: {
    messageId?: string;
    senderId?: Types.ObjectId;
    body: string;
    createdAt: Date;
  };
  lastMessageAt?: Date;
  unreadCounts?: Map<string, number>;
  projectId?: Types.ObjectId;
  meetingId?: Types.ObjectId;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    conversationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["DIRECT", "GROUP", "PROJECT", "MEETING"],
      default: "DIRECT",
      required: true,
    },
    name: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    groupImage: {
      type: String,
      default: null,
    },
    admins: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    divisionId: {
      type: Schema.Types.ObjectId,
      ref: "Division",
      default: null,
      index: true,
    },
    departmentId: {
      type: String,
      default: null,
      index: true,
    },
    teamId: {
      type: String,
      default: null,
      index: true,
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastMessage: {
      messageId: { type: String },
      senderId: { type: Schema.Types.ObjectId, ref: "User" },
      body: { type: String, trim: true },
      createdAt: { type: Date },
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
    },
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: "Meeting",
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast lookup
ConversationSchema.index({ organizationId: 1, participants: 1 });
ConversationSchema.index({ organizationId: 1, lastMessageAt: -1 });
ConversationSchema.index({ organizationId: 1, type: 1 });

const Conversation =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", ConversationSchema);

export default Conversation;
