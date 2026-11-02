import mongoose, { Schema } from "mongoose";

export type FileCategory =
  | "GENERAL"
  | "HR"
  | "EMPLOYEE"
  | "PROJECT"
  | "TASK"
  | "MEETING"
  | "COMMUNICATION"
  | "REPORT"
  | "CONTRACT"
  | "POLICY"
  | "OTHER";

export type FileStatus = "ACTIVE" | "ARCHIVED" | "DELETED";

export type FileVisibility =
  | "PRIVATE"
  | "USER"
  | "ORGANIZATION"
  | "DIVISION"
  | "TEAM"
  | "PROJECT"
  | "TASK"
  | "MEETING"
  | "HR_RESTRICTED";

export interface IFileVersion {
  version: number;
  storedName: string;
  storagePath: string;
  bucket?: string | null;
  objectKey?: string | null;
  size: number;
  mimeType: string;
  checksum: string;
  uploadedBy: mongoose.Types.ObjectId | string;
  uploadedAt: Date;
  note?: string;
}

export interface IFileRecord extends mongoose.Document {
  fileId: string;
  organizationId: mongoose.Types.ObjectId | string;
  uploadedBy: mongoose.Types.ObjectId | string;
  ownerId: mongoose.Types.ObjectId | string;
  originalName: string;
  storedName: string;
  mimeType: string;
  extension: string;
  size: number;
  checksum: string;
  storageProvider: string;
  storagePath: string;
  bucket?: string | null;
  objectKey?: string | null;
  category: FileCategory;
  description?: string | null;
  tags: string[];
  status: FileStatus;
  visibility: FileVisibility;
  divisionId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  projectId?: string | null;
  taskId?: string | null;
  meetingId?: string | null;
  employeeId?: mongoose.Types.ObjectId | string | null;
  conversationId?: mongoose.Types.ObjectId | string | null;
  parentFolderId?: mongoose.Types.ObjectId | string | null;
  version: number;
  isCurrent: boolean;
  versions: IFileVersion[];
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const FileVersionSchema = new Schema<IFileVersion>(
  {
    version: { type: Number, required: true },
    storedName: { type: String, required: true },
    storagePath: { type: String, required: true },
    bucket: { type: String, default: null },
    objectKey: { type: String, default: null },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    checksum: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
    note: { type: String, default: null },
  },
  { _id: false }
);

const FileRecordSchema = new Schema<IFileRecord>(
  {
    fileId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    extension: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, required: true, index: true },
    storageProvider: { type: String, default: "R2", index: true },
    storagePath: { type: String, required: true },
    bucket: { type: String, default: null },
    objectKey: { type: String, default: null, index: true },
    category: {
      type: String,
      enum: [
        "GENERAL",
        "HR",
        "EMPLOYEE",
        "PROJECT",
        "TASK",
        "MEETING",
        "COMMUNICATION",
        "REPORT",
        "CONTRACT",
        "POLICY",
        "OTHER",
      ],
      default: "GENERAL",
      index: true,
    },
    description: { type: String, default: null },
    tags: { type: [String], default: [], index: true },
    status: {
      type: String,
      enum: ["ACTIVE", "ARCHIVED", "DELETED"],
      default: "ACTIVE",
      index: true,
    },
    visibility: {
      type: String,
      enum: [
        "PRIVATE",
        "USER",
        "ORGANIZATION",
        "DIVISION",
        "TEAM",
        "PROJECT",
        "TASK",
        "MEETING",
        "HR_RESTRICTED",
      ],
      default: "ORGANIZATION",
      index: true,
    },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null, index: true },
    projectId: { type: String, default: null, index: true },
    taskId: { type: String, default: null, index: true },
    meetingId: { type: String, default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null, index: true },
    parentFolderId: { type: Schema.Types.ObjectId, ref: "Folder", default: null, index: true },
    version: { type: Number, default: 1 },
    isCurrent: { type: Boolean, default: true },
    versions: { type: [FileVersionSchema], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Performance & Filtering Compound Indexes
FileRecordSchema.index({ organizationId: 1, status: 1 });
FileRecordSchema.index({ organizationId: 1, parentFolderId: 1 });
FileRecordSchema.index({ organizationId: 1, category: 1 });
FileRecordSchema.index({ organizationId: 1, visibility: 1 });
FileRecordSchema.index({ organizationId: 1, createdAt: -1 });
FileRecordSchema.index({ organizationId: 1, divisionId: 1 });

export const FileRecord =
  (mongoose.models.FileRecord as mongoose.Model<IFileRecord>) ||
  mongoose.model<IFileRecord>("FileRecord", FileRecordSchema);

export default FileRecord;
