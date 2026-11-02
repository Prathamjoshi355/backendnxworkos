import EmployeeDocument, { DocumentType, DocumentStatus } from "../models/EmployeeDocument";
import User from "../models/User";
import { recordAuditLog } from "./auditLogService";
import { storageProvider } from "./storageService";

export const REQUIRED_EMPLOYEE_DOCS: { type: DocumentType; title: string; requiredForEmployee: boolean; requiredForIntern: boolean }[] = [
  { type: "ACCEPTANCE_LETTER", title: "Signed Onboarding Acceptance Letter", requiredForEmployee: true, requiredForIntern: true },
  { type: "AADHAAR_CARD", title: "Aadhaar Card (Front & Back)", requiredForEmployee: true, requiredForIntern: true },
  { type: "PAN_CARD", title: "PAN Card", requiredForEmployee: true, requiredForIntern: false },
  { type: "PHOTOGRAPH", title: "Passport Size Photograph (PDF)", requiredForEmployee: true, requiredForIntern: true },
  { type: "EDUCATION_CERTIFICATE", title: "Educational Degree / Certificates", requiredForEmployee: true, requiredForIntern: true },
  { type: "BANK_PROOF", title: "Bank Account Proof / Cancelled Cheque", requiredForEmployee: true, requiredForIntern: true },
  { type: "RESUME", title: "Resume / Curriculum Vitae", requiredForEmployee: false, requiredForIntern: false },
  { type: "EXPERIENCE_CERTIFICATE", title: "Previous Employment Proof", requiredForEmployee: false, requiredForIntern: false },
  { type: "RELIEVING_LETTER", title: "Relieving / Experience Letter", requiredForEmployee: false, requiredForIntern: false },
  { type: "EMPLOYMENT_AGREEMENT", title: "Employment Agreement / NDA", requiredForEmployee: false, requiredForIntern: false },
  { type: "ADDRESS_PROOF", title: "Address Proof", requiredForEmployee: false, requiredForIntern: false },
  { type: "TAX_DECLARATION", title: "Tax Declaration (Form 12BB / 16)", requiredForEmployee: false, requiredForIntern: false },
  { type: "OTHER", title: "Other Supporting Documents", requiredForEmployee: false, requiredForIntern: false },
];

export async function uploadOnboardingAcceptanceLetter(
  currentUser: any,
  userId: string,
  file: {
    buffer: Buffer;
    fileName: string;
    mimeType?: string;
  }
) {
  // Validate file signature: must be PDF (%PDF-)
  if (!file.buffer || file.buffer.length < 4 || file.buffer.slice(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("INVALID_PDF_FILE: Acceptance letter must be a valid PDF document with %PDF header signature.");
  }

  // Upload to secure private storage provider
  const uploadRes = await storageProvider.upload({
    buffer: file.buffer,
    fileName: file.fileName || "acceptance_letter.pdf",
    mimeType: "application/pdf",
    destinationSubdir: String(currentUser.organizationId || "global"),
  });

  // Create EmployeeDocument record
  const doc = await EmployeeDocument.create({
    userId,
    organizationId: currentUser.organizationId,
    documentType: "ACCEPTANCE_LETTER",
    title: "Onboarding Acceptance Letter",
    fileName: uploadRes.fileName,
    fileUrl: uploadRes.fileUrl,
    storageKey: uploadRes.storagePath,
    fileSize: uploadRes.fileSize,
    mimeType: "application/pdf",
    uploadedBy: currentUser._id,
    version: 1,
    isCurrent: true,
    status: "SUBMITTED",
  });

  await recordAuditLog({
    organizationId: String(currentUser.organizationId || ""),
    actorId: String(currentUser._id),
    actorRole: currentUser.role,
    action: "ONBOARDING_ACCEPTANCE_LETTER_UPLOADED",
    entityType: "EMPLOYEE_DOCUMENT",
    entityId: String(doc._id),
    summary: `Uploaded mandatory onboarding acceptance letter for user ${userId}`,
  });

  return doc.toObject();
}

export async function createDocument(user: any, payload: any) {
  const currentUserId = String(user._id || user.id);
  const targetUserId = payload.userId ? String(payload.userId) : currentUserId;

  // Authorization check for target user
  const isSelf = targetUserId === currentUserId;
  const isPrivileged = ["SUPER_ADMIN", "ADMIN", "HR"].includes(user.role);

  if (!isSelf && !isPrivileged) {
    throw new Error("UNAUTHORIZED_DOCUMENT_UPLOAD");
  }

  // Ensure target user belongs to same organization (if Admin/HR)
  if (user.role !== "SUPER_ADMIN") {
    const targetUser = await User.findById(targetUserId).lean();
    if (!targetUser) throw new Error("USER_NOT_FOUND");
    if (targetUser.organizationId && String(targetUser.organizationId) !== String(user.organizationId)) {
      throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
    }
  }

  let finalFileUrl = payload.fileUrl;
  let finalFileName = payload.fileName || `${payload.title || "document"}.pdf`;
  let finalFileSize = payload.fileSize || 1024;
  let finalMimeType = payload.mimeType || "application/pdf";
  let storageKey: string | null = null;

  // Handle file buffer/base64 upload via storage provider
  if (payload.fileBuffer || (payload.fileData && typeof payload.fileData === "string")) {
    let buf: Buffer;
    if (Buffer.isBuffer(payload.fileBuffer)) {
      buf = payload.fileBuffer;
    } else {
      const b64 = typeof payload.fileData === "string" && payload.fileData.includes(";base64,")
        ? payload.fileData.split(";base64,").pop()!
        : (payload.fileData || payload.fileBuffer);
      buf = Buffer.from(b64, "base64");
    }

    // Verify PDF format (Requirement: All employee submitted files must be PDF format)
    if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") !== "%PDF") {
      throw new Error("INVALID_PDF_FORMAT: Submitted file must be a valid PDF document with %PDF magic header.");
    }

    const uploadRes = await storageProvider.upload({
      buffer: buf,
      fileName: finalFileName,
      mimeType: "application/pdf",
      destinationSubdir: String(user.organizationId || "global"),
    });
    finalFileUrl = uploadRes.fileUrl;
    finalFileName = uploadRes.fileName;
    finalFileSize = uploadRes.fileSize;
    finalMimeType = "application/pdf";
    storageKey = uploadRes.storagePath;
  }

  if (!finalFileUrl) {
    finalFileUrl = `/uploads/docs/${Date.now()}_${finalFileName}`;
  }

  const docType = payload.documentType || "OTHER";

  // Document versioning: query previous versions of this docType for this user
  const prevDocs = await EmployeeDocument.find({
    userId: targetUserId,
    documentType: docType,
    status: { $ne: "ARCHIVED" },
  })
    .sort({ version: -1 })
    .lean();

  let newVersion = 1;
  if (prevDocs.length > 0) {
    newVersion = (prevDocs[0].version || 1) + 1;
    // Mark previous documents as not current
    await EmployeeDocument.updateMany(
      { userId: targetUserId, documentType: docType },
      { $set: { isCurrent: false } }
    );
  }

  let parsedExpiresAt: Date | null = null;
  if (payload.expiresAt) {
    parsedExpiresAt = new Date(payload.expiresAt);
  }

  const doc = await EmployeeDocument.create({
    userId: targetUserId,
    organizationId: user.organizationId,
    documentType: docType,
    title: payload.title || "Document",
    fileName: finalFileName,
    fileUrl: finalFileUrl,
    storageKey,
    fileSize: finalFileSize,
    mimeType: finalMimeType,
    uploadedBy: currentUserId,
    version: newVersion,
    isCurrent: true,
    expiresAt: parsedExpiresAt,
    status: payload.status || "SUBMITTED",
  });

  await recordAuditLog({
    organizationId: String(user.organizationId || ""),
    actorId: currentUserId,
    actorRole: user.role,
    action: "DOCUMENT_UPLOADED",
    entityType: "EMPLOYEE_DOCUMENT",
    entityId: String(doc._id),
    summary: `Uploaded document ${doc.title} (${doc.documentType}) v${newVersion} for user ${targetUserId}`,
    metadata: { documentType: doc.documentType, fileName: finalFileName, targetUserId, version: newVersion },
  });

  return doc.toObject();
}

export async function listDocuments(user: any, targetUserId?: string, filters: any = {}) {
  const currentUserId = String(user._id || user.id);
  const isEmployee = ["EMPLOYEE", "INTERN", "DESIGNER", "SALES_EXECUTIVE", "MARKETING", "DEVELOPER"].includes(user.role);

  let query: any = { status: { $ne: "ARCHIVED" }, ...filters };

  if (user.role !== "SUPER_ADMIN" && user.organizationId) {
    query.organizationId = user.organizationId;
  }

  if (isEmployee) {
    // Normal employee can strictly only query own documents
    query.userId = currentUserId;
  } else if (targetUserId) {
    query.userId = targetUserId;
  }

  const items = await EmployeeDocument.find(query)
    .sort({ createdAt: -1 })
    .populate("userId", "fullName email employeeId designation departmentId teamId")
    .populate("uploadedBy", "fullName email")
    .populate("verifiedBy", "fullName email")
    .lean();

  return items;
}

export async function getDocumentById(docId: string, user: any) {
  const doc = await EmployeeDocument.findById(docId)
    .populate("userId", "fullName email employeeId designation")
    .populate("uploadedBy", "fullName email")
    .populate("verifiedBy", "fullName email")
    .lean();

  if (!doc || doc.status === "ARCHIVED") throw new Error("DOCUMENT_NOT_FOUND");

  const currentUserId = String(user._id || user.id);
  const isOwner = String((doc.userId as any)?._id || doc.userId) === currentUserId;
  const isPrivileged = ["SUPER_ADMIN", "ADMIN", "HR"].includes(user.role);

  if (!isOwner && !isPrivileged) {
    throw new Error("FORBIDDEN");
  }

  if (user.role !== "SUPER_ADMIN" && doc.organizationId && String(doc.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
  }

  return doc;
}

export async function verifyDocument(
  docId: string,
  user: any,
  verification: { isApproved: boolean; rejectionReason?: string }
) {
  // Only Super Admin, Admin, and HR can verify documents
  if (!["SUPER_ADMIN", "ADMIN", "HR"].includes(user.role)) {
    throw new Error("UNAUTHORIZED_DOCUMENT_VERIFICATION");
  }

  const doc = await EmployeeDocument.findById(docId);
  if (!doc || doc.status === "ARCHIVED") throw new Error("DOCUMENT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && doc.organizationId && String(doc.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN_ORGANIZATION_ACCESS");
  }

  const currentUserId = String(user._id || user.id);

  // Users cannot approve their own documents (Admin/HR must have another Admin verify, unless Super Admin)
  if (String(doc.userId) === currentUserId && user.role !== "SUPER_ADMIN") {
    throw new Error("CANNOT_APPROVE_OWN_DOCUMENT");
  }

  const newStatus: DocumentStatus = verification.isApproved ? "APPROVED" : "REJECTED";

  doc.status = newStatus;
  doc.verifiedBy = currentUserId as any;
  doc.verifiedAt = new Date();
  doc.reviewedBy = currentUserId as any;
  doc.reviewedAt = new Date();
  doc.rejectionReason = verification.isApproved ? null : (verification.rejectionReason || "Document verification rejected.");

  await doc.save();

  // Send notification to document owner
  try {
    const { createNotification } = await import("./notificationService");
    await createNotification({
      recipientId: String(doc.userId),
      organizationId: String(doc.organizationId || ""),
      title: verification.isApproved ? "Document Verified" : "Document Rejected",
      message: verification.isApproved
        ? `Your document "${doc.title}" has been verified.`
        : `Your document "${doc.title}" was rejected: ${doc.rejectionReason || "Please re-upload a valid document."}`,
      type: "GENERAL",
      priority: verification.isApproved ? "NORMAL" : "HIGH",
    });
  } catch (_) {}

  const auditAction = verification.isApproved ? "DOCUMENT_VERIFIED" : "DOCUMENT_REJECTED";
  await recordAuditLog({
    organizationId: String(doc.organizationId || user.organizationId || ""),
    actorId: currentUserId,
    actorRole: user.role,
    action: auditAction,
    entityType: "EMPLOYEE_DOCUMENT",
    entityId: String(doc._id),
    summary: `${verification.isApproved ? "Verified" : "Rejected"} document ${doc.title} (${doc.documentType}) v${doc.version || 1}`,
    metadata: {
      newStatus,
      rejectionReason: doc.rejectionReason,
      targetUserId: String(doc.userId),
      version: doc.version,
    },
  });

  return doc.toObject();
}

export async function deleteDocument(docId: string, user: any) {
  const doc = await EmployeeDocument.findById(docId);
  if (!doc) throw new Error("DOCUMENT_NOT_FOUND");

  const currentUserId = String(user._id || user.id);
  const isUploader = String(doc.uploadedBy) === currentUserId;
  const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(user.role);

  if (!isUploader && !isPrivileged) {
    throw new Error("UNAUTHORIZED_DOCUMENT_DELETE");
  }

  doc.status = "ARCHIVED";
  await doc.save();

  await recordAuditLog({
    organizationId: String(doc.organizationId || user.organizationId || ""),
    actorId: currentUserId,
    actorRole: user.role,
    action: "DOCUMENT_DELETED",
    entityType: "EMPLOYEE_DOCUMENT",
    entityId: String(doc._id),
    summary: `Archived document ${doc.title} v${doc.version || 1}`,
    metadata: { targetUserId: String(doc.userId) },
  });

  return doc.toObject();
}

export async function getDocumentChecklist(userId: string, employmentType: string = "EMPLOYEE") {
  const isIntern = employmentType === "INTERN";
  const existingDocs = await EmployeeDocument.find({ userId, status: { $ne: "ARCHIVED" } }).lean();

  const docMap = new Map<string, any>();
  const versionsMap = new Map<string, any[]>();

  for (const doc of existingDocs) {
    const list = versionsMap.get(doc.documentType) || [];
    list.push(doc);
    versionsMap.set(doc.documentType, list);

    if (doc.isCurrent !== false) {
      docMap.set(doc.documentType, doc);
    }
  }

  const checklist = REQUIRED_EMPLOYEE_DOCS.map((item) => {
    const isRequired = isIntern ? item.requiredForIntern : item.requiredForEmployee;
    const existing = docMap.get(item.type);
    const allVersions = versionsMap.get(item.type) || [];

    // Check if expired
    let computedStatus = existing ? existing.status : (isRequired ? "REQUIRED" : "NOT_APPLICABLE");
    if (existing && existing.expiresAt && new Date(existing.expiresAt) < new Date() && existing.status === "VERIFIED") {
      computedStatus = "EXPIRED";
    }

    return {
      type: item.type,
      title: item.title,
      isRequired,
      status: computedStatus,
      documentId: existing ? String(existing._id) : null,
      fileUrl: existing ? existing.fileUrl : null,
      fileName: existing ? existing.fileName : null,
      version: existing?.version || (allVersions.length > 0 ? allVersions.length : 1),
      totalVersions: allVersions.length,
      expiresAt: existing?.expiresAt || null,
      rejectionReason: existing ? existing.rejectionReason : null,
      verifiedAt: existing ? existing.verifiedAt : null,
      uploadedAt: existing ? existing.createdAt : null,
    };
  });

  return checklist;
}

