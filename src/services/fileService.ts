import crypto from "crypto";
import mongoose from "mongoose";
import FileRecord, { IFileRecord } from "../models/FileRecord";
import Folder, { IFolder } from "../models/Folder";
import storageProvider from "./storageService";
import { validateUploadFile, sanitizeFileName } from "../utils/fileSecurity";
import { canAccessFile } from "./fileAccessService";
import { recordAuditLog } from "./auditLogService";
import {
  emitFileCreated,
  emitFileUpdated,
  emitFileDeleted,
  emitFileRestored,
  emitFileVersionCreated,
  emitFolderCreated,
  emitFolderUpdated,
  emitFolderDeleted,
} from "../lib/socketEmitters";

function generateFileId(): string {
  return "file_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
}

function generateFolderId(): string {
  return "fld_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
}

/**
 * List files with filtering, RBAC scoping, and pagination.
 */
export async function listFiles(
  user: any,
  params: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    status?: string;
    parentFolderId?: string | null;
    projectId?: string;
    taskId?: string;
    meetingId?: string;
    employeeId?: string;
    visibility?: string;
    organizationId?: string;
  } = {}
) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const skip = (page - 1) * limit;

  const currentUserId = String(user._id || user.id);
  const query: Record<string, any> = {};

  // Multi-tenant organization scoping
  if (user.role === "SUPER_ADMIN") {
    if (params.organizationId) {
      query.organizationId = params.organizationId;
    }
  } else {
    query.organizationId = user.organizationId;
  }

  // Status filter (default ACTIVE)
  query.status = params.status || "ACTIVE";

  // Category filter
  if (params.category && params.category !== "ALL") {
    query.category = params.category;
  }

  // Parent folder filter
  if (params.parentFolderId !== undefined) {
    if (params.parentFolderId === null || params.parentFolderId === "root") {
      query.parentFolderId = null;
    } else {
      query.parentFolderId = params.parentFolderId;
    }
  }

  // Domain filters
  if (params.projectId) query.projectId = params.projectId;
  if (params.taskId) query.taskId = params.taskId;
  if (params.meetingId) query.meetingId = params.meetingId;
  if (params.employeeId) query.employeeId = params.employeeId;
  if (params.visibility) query.visibility = params.visibility;

  // Search filter
  if (params.search && params.search.trim().length > 0) {
    const sRegex = { $regex: params.search.trim(), $options: "i" };
    query.$or = [{ originalName: sRegex }, { description: sRegex }, { tags: sRegex }];
  }

  // Enforce Employee RBAC Scoping in MongoDB Query
  if (user.role === "EMPLOYEE") {
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        // Uploaded or owned by employee
        { uploadedBy: user._id || user.id },
        { ownerId: user._id || user.id },
        // Dedicated employee HR documents
        { employeeId: user._id || user.id },
        // General organization documents that are not HR restricted
        {
          visibility: "ORGANIZATION",
          category: { $nin: ["HR"] },
        },
        // Team documents if user has a team
        ...(user.teamId ? [{ visibility: "TEAM", teamId: user.teamId }] : []),
      ],
    });
  }

  const [items, total] = await Promise.all([
    FileRecord.find(query)
      .populate("uploadedBy", "fullName email employeeId")
      .populate("ownerId", "fullName email employeeId")
      .populate("parentFolderId", "name folderId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FileRecord.countDocuments(query),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

function parseFileBuffer(input: Buffer | string): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string") {
    if (input.startsWith("data:") && input.includes(";base64,")) {
      const base64Data = input.split(";base64,").pop() || "";
      return Buffer.from(base64Data, "base64");
    }
    const trimmed = input.trim();
    if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
      try {
        const decoded = Buffer.from(trimmed, "base64");
        if (decoded.length > 0 && decoded.toString("base64") === trimmed) {
          return decoded;
        }
      } catch {
        // Fall back to utf-8
      }
    }
    return Buffer.from(input, "utf-8");
  }
  return Buffer.from("");
}

/**
 * Upload a file with security validation, persistence, audit logging, and realtime events.
 */
export async function uploadFile(
  user: any,
  payload: {
    buffer: Buffer | string;
    fileName: string;
    mimeType?: string;
    category?: string;
    description?: string;
    tags?: string[] | string;
    parentFolderId?: string | null;
    visibility?: string;
    projectId?: string;
    taskId?: string;
    meetingId?: string;
    employeeId?: string;
    organizationId?: string;
  }
) {
  const buffer = parseFileBuffer(payload.buffer);

  // 1. Security Validation
  const validation = validateUploadFile(buffer, payload.fileName, payload.mimeType);
  if (!validation.isValid) {
    throw new Error(validation.error || "INVALID_FILE_UPLOAD");
  }

  // 2. Organization Scoping
  let targetOrgId = user.organizationId;
  if (user.role === "SUPER_ADMIN" && payload.organizationId) {
    targetOrgId = payload.organizationId;
  }
  if (!targetOrgId) {
    throw new Error("ORGANIZATION_REQUIRED");
  }

  // 3. Parent Folder validation
  let folderObjectId: mongoose.Types.ObjectId | null = null;
  if (payload.parentFolderId && payload.parentFolderId !== "root") {
    const folder = await Folder.findOne({
      $or: [{ folderId: payload.parentFolderId }, { _id: payload.parentFolderId }],
      organizationId: targetOrgId,
      status: "ACTIVE",
    }).lean();
    if (!folder) {
      throw new Error("FOLDER_NOT_FOUND");
    }
    folderObjectId = folder._id as mongoose.Types.ObjectId;
  }

  // 4. Parse Tags
  let tagsList: string[] = [];
  if (Array.isArray(payload.tags)) {
    tagsList = payload.tags.map((t) => String(t).trim()).filter(Boolean);
  } else if (typeof payload.tags === "string") {
    tagsList = payload.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // 5. Store File in Object Storage (Cloudflare R2)
  const fileId = generateFileId();
  const uploadRes = await storageProvider.upload({
    buffer,
    fileName: validation.sanitizedFileName,
    mimeType: validation.detectedMimeType,
    destinationSubdir: String(targetOrgId),
    organizationId: String(targetOrgId),
    employeeId: payload.employeeId ? String(payload.employeeId) : String(user._id || user.id),
    fileId,
  });

  // 6. Create Canonical FileRecord in MongoDB
  let fileRecord: any;
  try {
    fileRecord = await FileRecord.create({
      fileId,
      organizationId: targetOrgId,
      uploadedBy: user._id || user.id,
      ownerId: user._id || user.id,
      originalName: validation.sanitizedFileName,
      storedName: uploadRes.fileName,
      mimeType: uploadRes.mimeType,
      extension: validation.extension,
      size: uploadRes.fileSize,
      checksum: uploadRes.checksum,
      storageProvider: uploadRes.storageProvider || "R2",
      storagePath: uploadRes.storagePath,
      bucket: uploadRes.bucket || null,
      objectKey: uploadRes.objectKey || uploadRes.storagePath,
      category: payload.category || "GENERAL",
      description: payload.description || null,
      tags: tagsList,
      status: "ACTIVE",
      visibility: payload.visibility || "ORGANIZATION",
      parentFolderId: folderObjectId,
      projectId: payload.projectId || null,
      taskId: payload.taskId || null,
      meetingId: payload.meetingId || null,
      employeeId: payload.employeeId || null,
      version: 1,
      isCurrent: true,
      versions: [],
    });
  } catch (dbErr) {
    // Partial failure cleanup: delete orphaned object from R2 if MongoDB creation fails
    try {
      await storageProvider.delete(uploadRes.storagePath);
    } catch (_) {}
    throw dbErr;
  }

  // 7. Audit Logging
  await recordAuditLog({
    organizationId: String(targetOrgId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FILE_UPLOADED",
    entityType: "FILE",
    entityId: fileRecord._id as any,
    summary: `Uploaded file '${validation.sanitizedFileName}' (${Math.round(uploadRes.fileSize / 1024)} KB)`,
    metadata: {
      fileId,
      originalName: validation.sanitizedFileName,
      size: uploadRes.fileSize,
      mimeType: uploadRes.mimeType,
      category: fileRecord.category,
      checksum: uploadRes.checksum,
    },
  });

  // 8. Socket.IO Real-time Emission
  emitFileCreated(String(targetOrgId), fileRecord.toObject(), {
    userId: user._id || user.id,
    projectId: payload.projectId,
  });

  return fileRecord;
}

/**
 * Get file metadata with authorization check.
 */
export async function getFileById(user: any, fileIdentifier: string) {
  const file = await FileRecord.findOne({
    $or: [{ fileId: fileIdentifier }, { _id: mongoose.isValidObjectId(fileIdentifier) ? fileIdentifier : null }],
  })
    .populate("uploadedBy", "fullName email employeeId")
    .populate("ownerId", "fullName email employeeId")
    .populate("parentFolderId", "name folderId");

  if (!file) {
    throw new Error("FILE_NOT_FOUND");
  }

  if (!canAccessFile(user, file, "READ")) {
    throw new Error("FORBIDDEN_FILE_ACCESS");
  }

  return file;
}

/**
 * Secure file download with RBAC verification and audit trail.
 */
export async function downloadFile(user: any, fileIdentifier: string) {
  const file = await FileRecord.findOne({
    $or: [{ fileId: fileIdentifier }, { _id: mongoose.isValidObjectId(fileIdentifier) ? fileIdentifier : null }],
  });

  if (!file) {
    throw new Error("FILE_NOT_FOUND");
  }

  if (!canAccessFile(user, file, "DOWNLOAD")) {
    throw new Error("FORBIDDEN_FILE_DOWNLOAD");
  }

  // Retrieve buffer from storage provider
  const fileData = await storageProvider.read(file.storagePath);

  // Record audit log
  await recordAuditLog({
    organizationId: String(file.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FILE_DOWNLOADED",
    entityType: "FILE",
    entityId: file._id as any,
    summary: `Downloaded file '${file.originalName}'`,
    metadata: {
      fileId: file.fileId,
      size: fileData.size,
      checksum: file.checksum,
    },
  });

  return {
    buffer: fileData.buffer,
    size: fileData.size,
    mimeType: file.mimeType || "application/octet-stream",
    originalName: file.originalName,
  };
}

/**
 * Update file metadata (name, description, tags, folder, category, visibility).
 */
export async function updateFileMetadata(
  user: any,
  fileIdentifier: string,
  updates: {
    originalName?: string;
    description?: string;
    tags?: string[] | string;
    category?: string;
    visibility?: string;
    parentFolderId?: string | null;
  }
) {
  const file = await FileRecord.findOne({
    $or: [{ fileId: fileIdentifier }, { _id: mongoose.isValidObjectId(fileIdentifier) ? fileIdentifier : null }],
  });

  if (!file) {
    throw new Error("FILE_NOT_FOUND");
  }

  if (!canAccessFile(user, file, "WRITE")) {
    throw new Error("FORBIDDEN_FILE_UPDATE");
  }

  if (updates.originalName) {
    file.originalName = sanitizeFileName(updates.originalName);
  }
  if (updates.description !== undefined) {
    file.description = updates.description;
  }
  if (updates.category) {
    file.category = updates.category as any;
  }
  if (updates.visibility) {
    file.visibility = updates.visibility as any;
  }
  if (updates.tags !== undefined) {
    if (Array.isArray(updates.tags)) {
      file.tags = updates.tags.map((t) => String(t).trim()).filter(Boolean);
    } else if (typeof updates.tags === "string") {
      file.tags = updates.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  if (updates.parentFolderId !== undefined) {
    if (!updates.parentFolderId || updates.parentFolderId === "root") {
      file.parentFolderId = null;
    } else {
      const folder = await Folder.findOne({
        $or: [{ folderId: updates.parentFolderId }, { _id: updates.parentFolderId }],
        organizationId: file.organizationId,
        status: "ACTIVE",
      });
      if (!folder) {
        throw new Error("FOLDER_NOT_FOUND");
      }
      file.parentFolderId = folder._id as mongoose.Types.ObjectId;
    }
  }

  await file.save();

  await recordAuditLog({
    organizationId: String(file.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FILE_METADATA_UPDATED",
    entityType: "FILE",
    entityId: file._id as any,
    summary: `Updated metadata for file '${file.originalName}'`,
    metadata: {
      fileId: file.fileId,
      updates,
    },
  });

  emitFileUpdated(String(file.organizationId), file.toObject());

  return file;
}

/**
 * Upload a new version of an existing file.
 */
export async function createFileVersion(
  user: any,
  fileIdentifier: string,
  payload: {
    buffer: Buffer | string;
    fileName?: string;
    mimeType?: string;
    note?: string;
  }
) {
  const file = await FileRecord.findOne({
    $or: [{ fileId: fileIdentifier }, { _id: mongoose.isValidObjectId(fileIdentifier) ? fileIdentifier : null }],
  });

  if (!file) {
    throw new Error("FILE_NOT_FOUND");
  }

  if (!canAccessFile(user, file, "WRITE")) {
    throw new Error("FORBIDDEN_FILE_VERSION");
  }

  const buffer = parseFileBuffer(payload.buffer);

  const fileNameToValidate = payload.fileName || file.originalName;
  const validation = validateUploadFile(buffer, fileNameToValidate, payload.mimeType || file.mimeType);
  if (!validation.isValid) {
    throw new Error(validation.error || "INVALID_FILE_VERSION");
  }

  // 1. Archive current version
  file.versions.push({
    version: file.version,
    storedName: file.storedName,
    storagePath: file.storagePath,
    bucket: file.bucket,
    objectKey: file.objectKey,
    size: file.size,
    mimeType: file.mimeType,
    checksum: file.checksum,
    uploadedBy: file.uploadedBy,
    uploadedAt: file.updatedAt || new Date(),
    note: payload.note,
  });

  // 2. Store new file version in R2
  const uploadRes = await storageProvider.upload({
    buffer,
    fileName: validation.sanitizedFileName,
    mimeType: validation.detectedMimeType,
    destinationSubdir: String(file.organizationId),
    organizationId: String(file.organizationId),
    employeeId: file.employeeId ? String(file.employeeId) : String(user._id || user.id),
    fileId: file.fileId,
  });

  // 3. Update current version details
  file.version += 1;
  file.storedName = uploadRes.fileName;
  file.storagePath = uploadRes.storagePath;
  file.bucket = uploadRes.bucket || null;
  file.objectKey = uploadRes.objectKey || uploadRes.storagePath;
  file.storageProvider = uploadRes.storageProvider || "R2";
  file.size = uploadRes.fileSize;
  file.checksum = uploadRes.checksum;
  file.mimeType = uploadRes.mimeType;
  file.extension = validation.extension;
  file.uploadedBy = user._id || user.id;

  await file.save();

  await recordAuditLog({
    organizationId: String(file.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FILE_VERSION_CREATED",
    entityType: "FILE",
    entityId: file._id as any,
    summary: `Uploaded version ${file.version} of file '${file.originalName}'`,
    metadata: {
      fileId: file.fileId,
      newVersion: file.version,
      size: file.size,
      checksum: file.checksum,
      note: payload.note,
    },
  });

  emitFileVersionCreated(String(file.organizationId), file.toObject());

  return file;
}

/**
 * Soft delete file.
 */
export async function deleteFile(user: any, fileIdentifier: string) {
  const file = await FileRecord.findOne({
    $or: [{ fileId: fileIdentifier }, { _id: mongoose.isValidObjectId(fileIdentifier) ? fileIdentifier : null }],
  });

  if (!file) {
    throw new Error("FILE_NOT_FOUND");
  }

  if (!canAccessFile(user, file, "DELETE")) {
    throw new Error("FORBIDDEN_FILE_DELETE");
  }

  file.status = "DELETED";
  file.deletedAt = new Date();
  await file.save();

  await recordAuditLog({
    organizationId: String(file.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FILE_DELETED",
    entityType: "FILE",
    entityId: file._id as any,
    summary: `Deleted file '${file.originalName}'`,
    metadata: {
      fileId: file.fileId,
      originalName: file.originalName,
    },
  });

  emitFileDeleted(String(file.organizationId), { fileId: file.fileId, status: "DELETED" });

  return file;
}

/**
 * Restore soft-deleted file.
 */
export async function restoreFile(user: any, fileIdentifier: string) {
  const file = await FileRecord.findOne({
    $or: [{ fileId: fileIdentifier }, { _id: mongoose.isValidObjectId(fileIdentifier) ? fileIdentifier : null }],
  });

  if (!file) {
    throw new Error("FILE_NOT_FOUND");
  }

  if (!canAccessFile(user, file, "WRITE")) {
    throw new Error("FORBIDDEN_FILE_RESTORE");
  }

  file.status = "ACTIVE";
  file.deletedAt = null;
  await file.save();

  await recordAuditLog({
    organizationId: String(file.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FILE_RESTORED",
    entityType: "FILE",
    entityId: file._id as any,
    summary: `Restored file '${file.originalName}'`,
    metadata: {
      fileId: file.fileId,
      originalName: file.originalName,
    },
  });

  emitFileRestored(String(file.organizationId), file.toObject());

  return file;
}

/**
 * Create a folder with hierarchy validation and audit trail.
 */
export async function createFolder(
  user: any,
  payload: {
    name: string;
    parentFolderId?: string | null;
    category?: string;
    organizationId?: string;
  }
) {
  if (!payload.name || payload.name.trim().length === 0) {
    throw new Error("FOLDER_NAME_REQUIRED");
  }

  let targetOrgId = user.organizationId;
  if (user.role === "SUPER_ADMIN" && payload.organizationId) {
    targetOrgId = payload.organizationId;
  }
  if (!targetOrgId) {
    throw new Error("ORGANIZATION_REQUIRED");
  }

  let parentId: mongoose.Types.ObjectId | null = null;
  if (payload.parentFolderId && payload.parentFolderId !== "root") {
    const parentFolder = await Folder.findOne({
      $or: [{ folderId: payload.parentFolderId }, { _id: payload.parentFolderId }],
      organizationId: targetOrgId,
      status: "ACTIVE",
    });
    if (!parentFolder) {
      throw new Error("PARENT_FOLDER_NOT_FOUND");
    }
    parentId = parentFolder._id as mongoose.Types.ObjectId;
  }

  const folderId = generateFolderId();
  const folder = await Folder.create({
    folderId,
    organizationId: targetOrgId,
    name: payload.name.trim(),
    parentFolderId: parentId,
    ownerId: user._id || user.id,
    category: payload.category || "GENERAL",
    status: "ACTIVE",
  });

  await recordAuditLog({
    organizationId: String(targetOrgId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FOLDER_CREATED",
    entityType: "FOLDER",
    entityId: folder._id as any,
    summary: `Created folder '${folder.name}'`,
    metadata: {
      folderId,
      name: folder.name,
      parentFolderId: payload.parentFolderId,
    },
  });

  emitFolderCreated(String(targetOrgId), folder.toObject());

  return folder;
}

/**
 * List folders for user's organization.
 */
export async function listFolders(
  user: any,
  params: { organizationId?: string; parentFolderId?: string | null; category?: string } = {}
) {
  const query: Record<string, any> = { status: "ACTIVE" };

  if (user.role === "SUPER_ADMIN" && params.organizationId) {
    query.organizationId = params.organizationId;
  } else {
    query.organizationId = user.organizationId;
  }

  if (params.category) {
    query.category = params.category;
  }

  if (params.parentFolderId !== undefined) {
    if (params.parentFolderId === null || params.parentFolderId === "root") {
      query.parentFolderId = null;
    } else {
      query.parentFolderId = params.parentFolderId;
    }
  }

  return Folder.find(query).sort({ name: 1 }).lean();
}

/**
 * Delete a folder.
 */
export async function deleteFolder(user: any, folderIdentifier: string) {
  const folder = await Folder.findOne({
    $or: [{ folderId: folderIdentifier }, { _id: mongoose.isValidObjectId(folderIdentifier) ? folderIdentifier : null }],
  });

  if (!folder) {
    throw new Error("FOLDER_NOT_FOUND");
  }

  const isOwner = String(folder.ownerId) === String(user._id || user.id);
  const isPrivileged = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  if (!isOwner && !isPrivileged) {
    throw new Error("FORBIDDEN_FOLDER_DELETE");
  }

  folder.status = "DELETED";
  folder.deletedAt = new Date();
  await folder.save();

  await recordAuditLog({
    organizationId: String(folder.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "FOLDER_DELETED",
    entityType: "FOLDER",
    entityId: folder._id as any,
    summary: `Deleted folder '${folder.name}'`,
    metadata: {
      folderId: folder.folderId,
      name: folder.name,
    },
  });

  emitFolderDeleted(String(folder.organizationId), { folderId: folder.folderId });

  return folder;
}
