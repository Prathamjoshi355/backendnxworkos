import mongoose, { Schema } from "mongoose";

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_UPDATED"
  | "TASK_STARTED"
  | "TASK_SUBMITTED"
  | "TASK_APPROVED"
  | "TASK_REJECTED"
  | "TASK_DEADLINE_SOON"
  | "TASK_OVERDUE"
  | "EOD_REPORT_PENDING"
  | "EOD_REPORT_SUBMITTED"
  | "EOD_APPROVED"
  | "EOD_RETURNED"
  | "BLOCKER_CREATED"
  | "BLOCKER_ESCALATED"
  | "TARGET_ACHIEVED"
  | "COMPENSATION_UPDATED"
  | "LEAVE"
  | "PROJECT"
  | "MEETING"
  | "ANNOUNCEMENT"
  | "GENERAL"
  | "CRM_LEAD_ASSIGNED"
  | "CRM_FOLLOWUP_REMINDER";

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface INotification extends mongoose.Document {
  recipientId: mongoose.Types.ObjectId | string;
  organizationId?: mongoose.Types.ObjectId | string | null;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  priority: NotificationPriority;
  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
  expiresAt?: Date | null;
  dedupeKey?: string | null;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
    priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL" },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    dedupeKey: { type: String, default: null, index: true, unique: true, sparse: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ recipientId: 1, createdAt: -1 });
NotificationSchema.index({ recipientId: 1, isRead: 1 });
NotificationSchema.index({ recipientId: 1, type: 1 });
NotificationSchema.index({ entityType: 1, entityId: 1 });

export const Notification = (mongoose.models.Notification as mongoose.Model<INotification>) || mongoose.model<INotification>("Notification", NotificationSchema);
export default Notification;
