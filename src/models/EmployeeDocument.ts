import mongoose, { Schema } from "mongoose";

export type DocumentType =
  | "ACCEPTANCE_LETTER"
  | "AADHAAR_CARD"
  | "PHOTOGRAPH"
  | "RESUME"
  | "PASSPORT_PHOTO"
  | "ID_PROOF"
  | "PAN_CARD"
  | "BANK_PROOF"
  | "EDUCATION_CERTIFICATE"
  | "EXPERIENCE_CERTIFICATE"
  | "RELIEVING_LETTER"
  | "OFFER_LETTER"
  | "EMPLOYMENT_AGREEMENT"
  | "NDA"
  | "ADDRESS_PROOF"
  | "UAN_EPFO"
  | "ESIC"
  | "TAX_DECLARATION"
  | "EMERGENCY_CONTACT"
  | "MEDICAL_CERTIFICATE"
  | "BACKGROUND_VERIFICATION"
  | "COMPENSATION_LETTER"
  | "JOINING_DOCUMENT"
  | "CERTIFICATE"
  | "OTHER";

export type DocumentStatus =
  | "PENDING"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "REQUIRED"
  | "UPLOADED"
  | "VERIFIED"
  | "EXPIRED"
  | "NOT_APPLICABLE"
  | "ACTIVE"
  | "ARCHIVED";

export interface IEmployeeDocument extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId: mongoose.Types.ObjectId | string;
  documentType: DocumentType;
  title: string;
  fileName: string;
  fileUrl: string;
  storageKey?: string | null;
  fileSize?: number;
  mimeType?: string;
  uploadedBy: mongoose.Types.ObjectId | string;
  verifiedBy?: mongoose.Types.ObjectId | string | null;
  verifiedAt?: Date | null;
  reviewedBy?: mongoose.Types.ObjectId | string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  isRequired?: boolean;
  version?: number;
  isCurrent?: boolean;
  expiresAt?: Date | null;
  status: DocumentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeDocumentSchema = new Schema<IEmployeeDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    documentType: {
      type: String,
      enum: [
        "ACCEPTANCE_LETTER",
        "AADHAAR_CARD",
        "PHOTOGRAPH",
        "RESUME",
        "PASSPORT_PHOTO",
        "ID_PROOF",
        "PAN_CARD",
        "BANK_PROOF",
        "EDUCATION_CERTIFICATE",
        "EXPERIENCE_CERTIFICATE",
        "RELIEVING_LETTER",
        "OFFER_LETTER",
        "EMPLOYMENT_AGREEMENT",
        "NDA",
        "ADDRESS_PROOF",
        "UAN_EPFO",
        "ESIC",
        "TAX_DECLARATION",
        "EMERGENCY_CONTACT",
        "MEDICAL_CERTIFICATE",
        "BACKGROUND_VERIFICATION",
        "COMPENSATION_LETTER",
        "JOINING_DOCUMENT",
        "CERTIFICATE",
        "OTHER",
      ],
      default: "OTHER",
      index: true,
    },
    title: { type: String, required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    storageKey: { type: String, default: null },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "application/pdf" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    isRequired: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    isCurrent: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, default: null },
    status: {
      type: String,
      enum: [
        "PENDING",
        "SUBMITTED",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "REQUIRED",
        "UPLOADED",
        "VERIFIED",
        "EXPIRED",
        "NOT_APPLICABLE",
        "ACTIVE",
        "ARCHIVED",
      ],
      default: "SUBMITTED",
      index: true,
    },
  },
  { timestamps: true }
);

EmployeeDocumentSchema.index({ organizationId: 1, userId: 1, status: 1 });
EmployeeDocumentSchema.index({ organizationId: 1, documentType: 1 });
EmployeeDocumentSchema.index({ userId: 1, createdAt: -1 });

export const EmployeeDocument =
  (mongoose.models.EmployeeDocument as mongoose.Model<IEmployeeDocument>) ||
  mongoose.model<IEmployeeDocument>("EmployeeDocument", EmployeeDocumentSchema);

export default EmployeeDocument;
