import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import Candidate, { ICandidate, CandidateStatus, OfferType } from "../models/Candidate";
import NXDocument from "../models/NXDocument";
import User from "../models/User";
import AuditLog from "../models/AuditLog";
import { createDocument, uploadDocumentAttachment, updateDocumentStatus } from "./documentManagementService";
import { generateEmployeeId } from "../utils/employeeId";
import { createUser } from "./userService";
import { logger } from "../utils/logger";

/**
 * Generate a unique Candidate ID: CAN-YYMMDD-XXX
 */
export async function generateCandidateId(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePrefix = `CAN-${yy}${mm}${dd}`;

  let attempts = 0;
  while (attempts < 50) {
    const randomSuffix = Math.floor(100 + Math.random() * 900); // 3 digits
    const candidateId = `${datePrefix}-${randomSuffix}`;
    const exists = await Candidate.exists({ candidateId });
    if (!exists) return candidateId;
    attempts++;
  }
  return `${datePrefix}-${Date.now().toString().slice(-4)}`;
}

/**
 * Create a new Candidate record
 */
export async function createCandidate(
  currentUser: any,
  payload: {
    fullName: string;
    email: string;
    phone?: string;
    designation: string;
    departmentId?: string;
    divisionId?: string;
    offerType?: OfferType;
    notes?: string;
  }
): Promise<ICandidate> {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_REQUIRED: User must belong to an organization.");
  }

  const candidateId = await generateCandidateId();
  const email = payload.email.trim().toLowerCase();

  const candidate = await Candidate.create({
    candidateId,
    organizationId: currentUser.organizationId,
    divisionId: payload.divisionId ? new Types.ObjectId(payload.divisionId) : (currentUser.divisionId ? new Types.ObjectId(currentUser.divisionId) : null),
    departmentId: payload.departmentId || currentUser.departmentId || null,
    fullName: payload.fullName.trim(),
    email,
    phone: payload.phone?.trim() || null,
    designation: payload.designation.trim(),
    offerType: payload.offerType || null,
    status: "CANDIDATE",
    notes: payload.notes?.trim() || null,
    createdBy: currentUser._id,
    activityHistory: [
      {
        action: "CANDIDATE_CREATED",
        performedBy: currentUser._id,
        performedByName: currentUser.fullName || currentUser.email,
        timestamp: new Date(),
        notes: `Created candidate record with ID ${candidateId}`,
      },
    ],
  });

  try {
    await AuditLog.create({
      organizationId: currentUser.organizationId,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      action: "CANDIDATE_CREATED",
      entityType: "CANDIDATE",
      entityId: candidate._id,
      summary: `Created candidate ${candidate.fullName} (${candidateId})`,
      metadata: { candidateId, email, designation: candidate.designation },
    });
  } catch (err: any) {
    logger.error("Audit log creation failed for candidate", { error: err.message });
  }

  return candidate;
}

/**
 * Generate official Offer Document (Employee Offer Letter or Internship Offer Letter)
 */
export async function generateOfferForCandidate(
  currentUser: any,
  candidateIdOrObjId: string,
  options: {
    offerType: OfferType;
    compensationAmount?: number;
    joiningDate?: Date | string;
    notes?: string;
  }
): Promise<{ candidate: ICandidate; document: any }> {
  const candidate = Types.ObjectId.isValid(candidateIdOrObjId)
    ? await Candidate.findById(candidateIdOrObjId)
    : await Candidate.findOne({ candidateId: candidateIdOrObjId });

  if (!candidate) {
    throw new Error("CANDIDATE_NOT_FOUND: Candidate record does not exist.");
  }

  if (candidate.status === "JOINED" || candidate.status === "EMPLOYEE_ACTIVE") {
    throw new Error("CANDIDATE_ALREADY_JOINED: Candidate is already onboarded as an active employee.");
  }

  // Determine separate document type code:
  // Employee Offer Letter -> 731
  // Internship Offer Letter -> 493
  const isInternship = options.offerType === "INTERNSHIP_OFFER";
  const typeCode = isInternship ? "493" : "731";
  const docTitle = isInternship
    ? `Internship Offer Letter - ${candidate.fullName}`
    : `Employee Offer Letter - ${candidate.fullName}`;

  // Register the document in Document Registry (generates immutable Document ID: N+CIN+...)
  const doc = await createDocument(currentUser, {
    title: docTitle,
    typeCode,
    documentType: isInternship ? "Internship Offer Letter" : "Employee Offer Letter",
    categoryCode: "HR_EMP",
    status: "PREPARED",
    confidentialityLevel: "CONFIDENTIAL",
    shortDescription: `Official offer of employment for ${candidate.fullName} (${candidate.designation})`,
    financialAmount: options.compensationAmount || null,
    effectiveDate: options.joiningDate ? new Date(options.joiningDate) : null,
    internalNotes: options.notes || `Issued for candidate ${candidate.candidateId}`,
  });

  candidate.offerType = options.offerType;
  candidate.offerDocumentId = doc.documentId;
  candidate.offerDocumentRef = doc._id as any;
  candidate.offerIssueDate = new Date();
  candidate.status = "OFFER_PREPARED";
  candidate.activityHistory.push({
    action: "OFFER_PREPARED",
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    timestamp: new Date(),
    notes: `Generated ${options.offerType} with Document ID ${doc.documentId}`,
    metadata: { offerDocumentId: doc.documentId },
  });

  await candidate.save();

  return { candidate, document: doc };
}

/**
 * Send offer to candidate (Starts the mandatory 7-day response window)
 */
export async function sendOfferToCandidate(
  currentUser: any,
  candidateIdOrObjId: string
): Promise<ICandidate> {
  const candidate = Types.ObjectId.isValid(candidateIdOrObjId)
    ? await Candidate.findById(candidateIdOrObjId)
    : await Candidate.findOne({ candidateId: candidateIdOrObjId });

  if (!candidate) {
    throw new Error("CANDIDATE_NOT_FOUND");
  }

  if (!candidate.offerDocumentId) {
    throw new Error("NO_OFFER_PREPARED: An offer document must be generated before sending.");
  }

  const now = new Date();
  // 7-day response period strictly counted from actual sent timestamp (Section 6)
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  candidate.offerSentAt = now;
  candidate.offerExpiresAt = expiresAt;
  candidate.status = "OFFER_SENT";
  candidate.activityHistory.push({
    action: "OFFER_SENT",
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    timestamp: now,
    notes: `Offer sent to ${candidate.email}. Response deadline: ${expiresAt.toISOString()}`,
    metadata: { offerSentAt: now, offerExpiresAt: expiresAt },
  });

  await candidate.save();

  // Update underlying NXDocument status to SENT
  if (candidate.offerDocumentRef) {
    try {
      await updateDocumentStatus(currentUser, candidate.offerDocumentRef, "SENT", "Offer sent to candidate");
    } catch (_) {}
  }

  try {
    await AuditLog.create({
      organizationId: candidate.organizationId,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      action: "OFFER_SENT",
      entityType: "CANDIDATE",
      entityId: candidate._id,
      summary: `Sent offer ${candidate.offerDocumentId} to candidate ${candidate.fullName} (7-day response deadline: ${expiresAt.toISOString()})`,
      metadata: { candidateId: candidate.candidateId, offerDocumentId: candidate.offerDocumentId, offerExpiresAt: expiresAt },
    });
  } catch (err: any) {
    logger.error("Audit log creation failed for offer sent", { error: err.message });
  }

  return candidate;
}

/**
 * Candidate submits accepted / signed offer document
 */
export async function submitSignedOffer(
  candidateIdOrObjId: string,
  file: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  },
  actingUser?: any
): Promise<ICandidate> {
  const candidate = Types.ObjectId.isValid(candidateIdOrObjId)
    ? await Candidate.findById(candidateIdOrObjId)
    : await Candidate.findOne({ candidateId: candidateIdOrObjId });

  if (!candidate) {
    throw new Error("CANDIDATE_NOT_FOUND");
  }

  if (candidate.status === "EXPIRED" || candidate.status === "CLOSED") {
    throw new Error("OFFER_EXPIRED: This offer has expired and can no longer accept submissions.");
  }

  // Check 7-day window
  if (candidate.offerExpiresAt && new Date() > candidate.offerExpiresAt) {
    candidate.status = "EXPIRED";
    await candidate.save();
    throw new Error("OFFER_EXPIRED: The 7-day acceptance deadline for this offer has passed.");
  }

  if (!candidate.offerDocumentRef) {
    throw new Error("NO_OFFER_DOCUMENT: No linked offer document found.");
  }

  // Attach signed copy to the existing Offer Document ID in NXDocument
  const actor = actingUser || {
    _id: candidate.createdBy,
    fullName: candidate.fullName,
    email: candidate.email,
    organizationId: candidate.organizationId,
    role: "HR",
  };

  const attachment = await uploadDocumentAttachment(actor, candidate.offerDocumentRef, {
    buffer: file.buffer,
    fileName: file.fileName,
    mimeType: file.mimeType,
    attachmentType: "SIGNED_COPY",
  });

  candidate.status = "DOCUMENT_SUBMITTED";
  candidate.offerSubmittedAt = new Date();
  candidate.submittedSignedCopyAttachmentId = attachment.attachmentId;
  candidate.activityHistory.push({
    action: "SIGNED_DOCUMENT_SUBMITTED",
    performedBy: actor._id,
    performedByName: candidate.fullName,
    timestamp: new Date(),
    notes: `Submitted signed copy '${file.fileName}' for offer ${candidate.offerDocumentId}`,
    metadata: { attachmentId: attachment.attachmentId },
  });

  await candidate.save();

  return candidate;
}

/**
 * HR Reviews and approves/rejects candidate submission
 */
export async function reviewOfferSubmission(
  currentUser: any,
  candidateIdOrObjId: string,
  decision: "APPROVE" | "REJECT",
  notes?: string
): Promise<ICandidate> {
  const candidate = Types.ObjectId.isValid(candidateIdOrObjId)
    ? await Candidate.findById(candidateIdOrObjId)
    : await Candidate.findOne({ candidateId: candidateIdOrObjId });

  if (!candidate) {
    throw new Error("CANDIDATE_NOT_FOUND");
  }

  const now = new Date();
  candidate.hrReviewedAt = now;
  candidate.hrReviewerId = currentUser._id;
  candidate.hrReviewNotes = notes || null;

  if (decision === "APPROVE") {
    candidate.status = "APPROVED";
    candidate.offerAcceptedAt = now;
  } else {
    candidate.status = "REJECTED";
    candidate.offerRejectedAt = now;
  }

  candidate.activityHistory.push({
    action: `HR_REVIEW_${decision}`,
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    timestamp: now,
    notes: notes || `Offer submission ${decision.toLowerCase()}d by HR`,
  });

  await candidate.save();

  if (candidate.offerDocumentRef) {
    try {
      await updateDocumentStatus(
        currentUser,
        candidate.offerDocumentRef,
        decision === "APPROVE" ? "ACTIVE" : "CANCELLED",
        notes
      );
    } catch (_) {}
  }

  return candidate;
}

/**
 * Final step: Convert approved candidate to joined Employee or Intern (Section 4 & 6)
 * Generates official NX-EMP-XXXX or NX-INT-XXXX ID.
 * Links historical Offer Document ID to employee record permanently.
 */
export async function onboardApprovedCandidate(
  currentUser: any,
  candidateIdOrObjId: string,
  options: {
    departmentId?: string;
    divisionId?: string;
    joiningDate?: Date | string;
    acceptanceLetterFile?: {
      buffer: Buffer;
      fileName: string;
      mimeType?: string;
    };
    acceptanceLetterBase64?: string;
    acceptanceLetterFileName?: string;
    requireAcceptanceLetter?: boolean;
  } = {}
): Promise<{ candidate: ICandidate; user: any }> {
  const candidate = Types.ObjectId.isValid(candidateIdOrObjId)
    ? await Candidate.findById(candidateIdOrObjId)
    : await Candidate.findOne({ candidateId: candidateIdOrObjId });

  if (!candidate) {
    throw new Error("CANDIDATE_NOT_FOUND");
  }

  if (candidate.status !== "APPROVED" && candidate.status !== "OFFER_ACCEPTED") {
    throw new Error("CANDIDATE_NOT_APPROVED: Candidate must be approved by HR prior to onboarding.");
  }

  const isIntern = candidate.offerType === "INTERNSHIP_OFFER";
  const employmentType = isIntern ? "INTERN" : "EMPLOYEE";
  const role = isIntern ? "INTERN" : "EMPLOYEE";

  // Resolve Acceptance Letter
  let acceptanceLetter = options.acceptanceLetterFile;
  if (!acceptanceLetter && options.acceptanceLetterBase64) {
    acceptanceLetter = {
      buffer: Buffer.from(options.acceptanceLetterBase64, "base64"),
      fileName: options.acceptanceLetterFileName || "acceptance_letter.pdf",
      mimeType: "application/pdf",
    };
  }

  // Validate mandatory Acceptance Letter if required
  const mustRequireLetter = options.requireAcceptanceLetter !== false;
  if (mustRequireLetter && !acceptanceLetter) {
    throw new Error("MANDATORY_ACCEPTANCE_LETTER_REQUIRED: Valid PDF Acceptance Letter is mandatory for employee onboarding.");
  }

  if (acceptanceLetter) {
    if (!acceptanceLetter.buffer || acceptanceLetter.buffer.length < 4 || acceptanceLetter.buffer.slice(0, 4).toString("ascii") !== "%PDF") {
      throw new Error("INVALID_PDF_FILE: Acceptance letter must be a valid PDF document with %PDF header signature.");
    }
  }

  // Staged / Atomic User creation with rollback on upload failure
  let newUser: any = null;
  try {
    // Create active User record via existing user service (uses standard password and mandatory change)
    newUser = await createUser({
      fullName: candidate.fullName,
      email: candidate.email,
      role,
      employmentType,
      designation: candidate.designation,
      organizationId: String(candidate.organizationId),
      divisionId: options.divisionId || (candidate.divisionId ? String(candidate.divisionId) : undefined),
      departmentId: options.departmentId || candidate.departmentId || undefined,
    });

    // If acceptance letter provided, attach to EmployeeDocument
    if (acceptanceLetter) {
      const { uploadOnboardingAcceptanceLetter } = await import("./employeeService");
      await uploadOnboardingAcceptanceLetter(
        currentUser,
        String(newUser._id),
        acceptanceLetter
      );
    }
  } catch (err: any) {
    if (newUser && newUser._id) {
      try {
        await User.findByIdAndDelete(newUser._id);
      } catch (delErr: any) {
        logger.error("Failed to rollback created user during aborted onboarding", { userId: newUser._id, error: delErr.message });
      }
    }
    throw err;
  }

  // Link historical Offer Document ID to employee record permanently without changing Offer ID
  candidate.convertedUserId = newUser._id;
  candidate.convertedEmployeeId = newUser.employeeId;
  candidate.joinedAt = options.joiningDate ? new Date(options.joiningDate) : new Date();
  candidate.status = "JOINED";

  candidate.activityHistory.push({
    action: "CANDIDATE_JOINED",
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    timestamp: new Date(),
    notes: `Candidate joined as ${employmentType} with ID ${newUser.employeeId}. Linked Offer Document ID: ${candidate.offerDocumentId}`,
    metadata: { employeeId: newUser.employeeId, userId: newUser._id, offerDocumentId: candidate.offerDocumentId },
  });

  await candidate.save();

  return { candidate, user: newUser };
}

/**
 * Seven-day offer expiry job (Section 6)
 * Idempotent: checks all active offers where offerExpiresAt < now and status == OFFER_SENT.
 * Preserves candidate and offer document records permanently.
 */
export async function processExpiredOffers(): Promise<{ expiredCount: number }> {
  const now = new Date();
  const candidatesToExpire = await Candidate.find({
    status: "OFFER_SENT",
    offerExpiresAt: { $lt: now },
  });

  let expiredCount = 0;
  for (const c of candidatesToExpire) {
    c.status = "EXPIRED";
    c.activityHistory.push({
      action: "OFFER_EXPIRED",
      performedBy: c.createdBy,
      performedByName: "System Scheduler",
      timestamp: now,
      notes: `Offer automatically expired after 7 days without acceptance (deadline was ${c.offerExpiresAt?.toISOString()})`,
    });
    await c.save();

    if (c.offerDocumentRef) {
      try {
        await NXDocument.findByIdAndUpdate(c.offerDocumentRef, {
          status: "EXPIRED",
          $push: {
            activityHistory: {
              action: "OFFER_EXPIRED",
              performedBy: c.createdBy,
              performedByName: "System Scheduler",
              performedAt: now,
              notes: "Offer expired after 7-day acceptance deadline passed without candidate confirmation",
            },
          },
        });
      } catch (_) {}
    }

    try {
      await AuditLog.create({
        organizationId: c.organizationId,
        actorId: c.createdBy,
        actorRole: "SYSTEM",
        action: "OFFER_EXPIRED",
        entityType: "CANDIDATE",
        entityId: c._id,
        summary: `Offer ${c.offerDocumentId} expired for candidate ${c.fullName} after 7-day period`,
        metadata: { candidateId: c.candidateId, offerDocumentId: c.offerDocumentId, expiredAt: now },
      });
    } catch (_) {}

    expiredCount++;
  }

  return { expiredCount };
}
