import mongoose, { Schema, Document, Types } from "mongoose";

export type CandidateStatus =
  | "CANDIDATE"
  | "OFFER_PREPARED"
  | "OFFER_SENT"
  | "OFFER_ACCEPTED"
  | "DOCUMENT_SUBMITTED"
  | "UNDER_HR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "JOINED"
  | "EMPLOYEE_ACTIVE"
  | "EXPIRED"
  | "CLOSED";

export type OfferType = "EMPLOYEE_OFFER" | "INTERNSHIP_OFFER";

export interface ICandidateActivity {
  action: string;
  performedBy: Types.ObjectId;
  performedByName?: string;
  timestamp: Date;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface ICandidate extends Document {
  candidateId: string; // e.g. CAN-YYYYMMDD-XXXX
  organizationId: Types.ObjectId;
  divisionId?: Types.ObjectId | null;
  departmentId?: string | null;

  fullName: string;
  email: string;
  phone?: string | null;
  designation: string;
  status: CandidateStatus;

  offerType?: OfferType | null;
  offerDocumentId?: string | null; // Permanent unique NXDocument ID
  offerDocumentRef?: Types.ObjectId | null; // Mongo ObjectId of NXDocument
  
  offerIssueDate?: Date | null;
  offerSentAt?: Date | null;
  offerExpiresAt?: Date | null; // 7 days from offerSentAt
  offerAcceptedAt?: Date | null;
  offerRejectedAt?: Date | null;
  offerSubmittedAt?: Date | null;
  hrReviewedAt?: Date | null;
  hrReviewerId?: Types.ObjectId | null;
  hrReviewNotes?: string | null;

  joinedAt?: Date | null;
  convertedUserId?: Types.ObjectId | null; // User._id once joined
  convertedEmployeeId?: string | null; // NX-EMP-XXXX or NX-INT-XXXX

  submittedSignedCopyAttachmentId?: string | null;

  activityHistory: ICandidateActivity[];
  notes?: string | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CandidateActivitySchema = new Schema<ICandidateActivity>(
  {
    action: { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    performedByName: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const CandidateSchema = new Schema<ICandidate>(
  {
    candidateId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    departmentId: { type: String, default: null, index: true },

    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, default: null },
    designation: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "CANDIDATE",
        "OFFER_PREPARED",
        "OFFER_SENT",
        "OFFER_ACCEPTED",
        "DOCUMENT_SUBMITTED",
        "UNDER_HR_REVIEW",
        "APPROVED",
        "REJECTED",
        "JOINED",
        "EMPLOYEE_ACTIVE",
        "EXPIRED",
        "CLOSED",
      ],
      default: "CANDIDATE",
      index: true,
    },

    offerType: { type: String, enum: ["EMPLOYEE_OFFER", "INTERNSHIP_OFFER"], default: null },
    offerDocumentId: { type: String, default: null, index: true },
    offerDocumentRef: { type: Schema.Types.ObjectId, ref: "NXDocument", default: null },

    offerIssueDate: { type: Date, default: null },
    offerSentAt: { type: Date, default: null, index: true },
    offerExpiresAt: { type: Date, default: null, index: true },
    offerAcceptedAt: { type: Date, default: null },
    offerRejectedAt: { type: Date, default: null },
    offerSubmittedAt: { type: Date, default: null },
    hrReviewedAt: { type: Date, default: null },
    hrReviewerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    hrReviewNotes: { type: String, default: null },

    joinedAt: { type: Date, default: null },
    convertedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    convertedEmployeeId: { type: String, default: null, index: true },

    submittedSignedCopyAttachmentId: { type: String, default: null },

    activityHistory: { type: [CandidateActivitySchema], default: [] },
    notes: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

CandidateSchema.index({ organizationId: 1, status: 1 });
CandidateSchema.index({ organizationId: 1, email: 1 });
CandidateSchema.index({ organizationId: 1, offerExpiresAt: 1 });

export const Candidate =
  (mongoose.models.Candidate as mongoose.Model<ICandidate>) ||
  mongoose.model<ICandidate>("Candidate", CandidateSchema);

export default Candidate;
