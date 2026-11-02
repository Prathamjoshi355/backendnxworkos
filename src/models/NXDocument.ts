import mongoose, { Schema, Document, Types } from "mongoose";

export type DocumentStatus =
  | "DRAFT"
  | "PREPARED"
  | "SENT"
  | "UNDER_REVIEW"
  | "PENDING_SIGNATURE"
  | "SIGNED"
  | "ACTIVE"
  | "EXPIRED"
  | "CANCELLED"
  | "ARCHIVED";

export type ConfidentialityLevel = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "STRICTLY_CONFIDENTIAL";

export type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

export type AttachmentType = "ORIGINAL" | "SIGNED_COPY" | "SIGNED_SCAN" | "SUPPORTING" | "CORRESPONDENCE" | "OTHER";

export interface IDocumentAttachment {
  _id?: Types.ObjectId;
  attachmentId: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  fileSizeBytes?: number;
  mimeType: string;
  storageKey: string;
  storageProvider: "R2" | "LOCAL";
  attachmentType: AttachmentType;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
  checksum?: string;
  checksumSha256?: string;
}

export interface IDocumentActivityLog {
  action: string;
  performedBy: Types.ObjectId;
  performedByName?: string;
  performedAt: Date;
  previousStatus?: string;
  newStatus?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface INXDocument extends Document {
  documentId: string; // Permanent unique alphanumeric: N + CIN + YYMMDD + RANDOM + TYPE_CODE
  organizationId: Types.ObjectId;
  divisionId?: Types.ObjectId | null;
  departmentId?: string | null;
  teamId?: string | null;

  title: string;
  categoryId: Types.ObjectId;
  documentTypeId: Types.ObjectId;
  documentTypeCode: string;
  documentType?: string;
  shortDescription?: string;
  documentDate: Date;
  issueDate?: Date | null;
  effectiveDate?: Date | null;
  expiryDate?: Date | null;
  status: DocumentStatus;
  confidentialityLevel: ConfidentialityLevel;
  tags: string[];

  // Allocation & Import distinction
  isLegacyImport: boolean;
  legacyReferenceId?: string | null;
  legacyReferenceNumber?: string | null;
  allocationNumber?: number | null;

  // Linked Entities
  clientCompanyId?: Types.ObjectId | null;
  externalCompanyName?: string | null;
  externalCompanyId?: string | null;
  employeeId?: Types.ObjectId | null;
  internId?: Types.ObjectId | null;
  vendorId?: string | null;
  projectId?: Types.ObjectId | null;

  // Financial Information
  financials?: {
    contractValue?: number;
    proposalValue?: number;
    currency: string;
    taxAmount?: number;
    gstAmount?: number;
    advanceAmount?: number;
    paidAmount?: number;
    pendingAmount?: number;
    paymentTerms?: string;
    paymentDueDate?: Date | null;
    paymentStatus?: PaymentStatus;
  } | null;

  // Attachments
  attachments: IDocumentAttachment[];

  // Internal Tracking
  responsibleDepartment?: string;
  assignedEmployeeId?: Types.ObjectId | null;
  reviewerId?: Types.ObjectId | null;
  internalNotes?: string;

  // Activity History
  activityHistory: IDocumentActivityLog[];

  // Archival
  isArchived: boolean;
  archivedAt?: Date | null;
  archivedBy?: Types.ObjectId | null;
  archiveReason?: string | null;
  archivedReason?: string | null;
  financialAmount?: number | null;
  financialCurrency?: string | null;
  financialTaxAmount?: number | null;
  validityStartDate?: Date | null;
  validityEndDate?: Date | null;

  createdBy: Types.ObjectId;
  lastUpdatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentAttachmentSchema = new Schema<IDocumentAttachment>(
  {
    attachmentId: { type: String, required: true },
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    fileSizeBytes: { type: Number },
    mimeType: { type: String, required: true },
    storageKey: { type: String, required: true },
    storageProvider: { type: String, enum: ["R2", "LOCAL"], default: "R2" },
    attachmentType: {
      type: String,
      enum: ["ORIGINAL", "SIGNED_COPY", "SIGNED_SCAN", "SUPPORTING", "CORRESPONDENCE", "OTHER"],
      default: "ORIGINAL",
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
    checksum: { type: String, default: null },
    checksumSha256: { type: String, default: null },
  },
  { _id: true }
);

const DocumentActivityLogSchema = new Schema<IDocumentActivityLog>(
  {
    action: { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    performedByName: { type: String, default: null },
    performedAt: { type: Date, default: Date.now },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    notes: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const NXDocumentSchema = new Schema<INXDocument>(
  {
    documentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
      immutable: true,
    },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    departmentId: { type: String, default: null, index: true },
    teamId: { type: String, default: null, index: true },

    title: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "DocumentCategory", required: true, index: true },
    documentTypeId: { type: Schema.Types.ObjectId, ref: "DocumentType", required: true, index: true },
    documentTypeCode: { type: String, required: true, index: true },
    documentType: { type: String, default: null, index: true },
    shortDescription: { type: String, default: null },
    documentDate: { type: Date, default: Date.now, index: true },
    issueDate: { type: Date, default: null, index: true },
    effectiveDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PREPARED",
        "SENT",
        "UNDER_REVIEW",
        "PENDING_SIGNATURE",
        "SIGNED",
        "ACTIVE",
        "EXPIRED",
        "CANCELLED",
        "ARCHIVED",
      ],
      default: "DRAFT",
      index: true,
    },
    confidentialityLevel: {
      type: String,
      enum: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "STRICTLY_CONFIDENTIAL"],
      default: "INTERNAL",
      index: true,
    },
    tags: { type: [String], default: [], index: true },

    isLegacyImport: { type: Boolean, default: false, index: true },
    legacyReferenceId: { type: String, default: null, index: true },
    legacyReferenceNumber: { type: String, default: null, index: true },
    allocationNumber: { type: Number, default: null },

    clientCompanyId: { type: Schema.Types.ObjectId, ref: "ClientCompany", default: null, index: true },
    externalCompanyName: { type: String, default: null },
    externalCompanyId: { type: String, default: null },
    employeeId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    internId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    vendorId: { type: String, default: null, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null, index: true },

    financials: { type: Schema.Types.Mixed, default: null },

    attachments: { type: [DocumentAttachmentSchema], default: [] },

    responsibleDepartment: { type: String, default: null },
    assignedEmployeeId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    internalNotes: { type: String, default: null },

    activityHistory: { type: [DocumentActivityLogSchema], default: [] },

    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    archiveReason: { type: String, default: null },
    archivedReason: { type: String, default: null },
    financialAmount: { type: Number, default: null },
    financialCurrency: { type: String, default: null },
    financialTaxAmount: { type: Number, default: null },
    validityStartDate: { type: Date, default: null },
    validityEndDate: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    lastUpdatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

NXDocumentSchema.index({ organizationId: 1, status: 1 });
NXDocumentSchema.index({ organizationId: 1, documentTypeCode: 1 });
NXDocumentSchema.index({ organizationId: 1, isLegacyImport: 1 });
NXDocumentSchema.index({ organizationId: 1, createdAt: -1 });

export const NXDocument =
  (mongoose.models.NXDocument as mongoose.Model<INXDocument>) ||
  mongoose.model<INXDocument>("NXDocument", NXDocumentSchema);

export default NXDocument;
