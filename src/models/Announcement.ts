import mongoose, { Schema } from "mongoose";

export type AnnouncementAudienceType = "ALL" | "DEPARTMENT" | "TEAM" | "ROLE" | "EMPLOYMENT_TYPE" | "USER";
export type AnnouncementPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type AnnouncementStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";

export interface IAnnouncement extends mongoose.Document {
  announcementId: string;
  organizationId: mongoose.Types.ObjectId | string;
  title: string;
  message: string;
  createdBy: mongoose.Types.ObjectId | string;
  audienceType: AnnouncementAudienceType;
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  role?: string | null;
  employmentType?: string | null;
  targetUserId?: mongoose.Types.ObjectId | string | null;
  priority: AnnouncementPriority;
  publishAt: Date;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  status: AnnouncementStatus;
  readBy: (mongoose.Types.ObjectId | string)[];
  archivedAt?: Date | null;
  archivedBy?: mongoose.Types.ObjectId | string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    announcementId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    audienceType: { type: String, enum: ["ALL", "DEPARTMENT", "TEAM", "ROLE", "EMPLOYMENT_TYPE", "USER"], default: "ALL" },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    role: { type: String, default: null },
    employmentType: { type: String, default: null },
    targetUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL" },
    publishAt: { type: Date, default: Date.now },
    publishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    status: { type: String, enum: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"], default: "DRAFT", index: true },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

AnnouncementSchema.index({ organizationId: 1, status: 1, publishAt: -1 });
AnnouncementSchema.index({ organizationId: 1, audienceType: 1 });

export const Announcement = (mongoose.models.Announcement as mongoose.Model<IAnnouncement>) || mongoose.model<IAnnouncement>("Announcement", AnnouncementSchema);
export default Announcement;
