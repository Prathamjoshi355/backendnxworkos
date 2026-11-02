import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAllocationLog {
  allocationNumber?: number;
  documentId?: string;
  documentTypeId?: Types.ObjectId;
  documentTypeCode?: string;
  isLegacyImport?: boolean;
  allocatedBy?: Types.ObjectId;
  allocatedAt?: Date;
  notes?: string;
  changedBy?: Types.ObjectId;
  metadata?: Record<string, any>;
}

export interface IDocumentAllocationControl extends Document {
  organizationId: Types.ObjectId;
  liveAllocationEnabled: boolean;
  startingAllocationValue: number;
  maxDocumentAllocation?: number;
  currentLiveAllocationCounter: number;
  totalLiveAllocations: number;
  totalLegacyImports: number;
  lastAllocatedAt?: Date | null;
  allocationHistory: IAllocationLog[];
  duplicatePreventionEvents: number;
  failedAllocationAttempts: number;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const AllocationLogSchema = new Schema<IAllocationLog>(
  {
    allocationNumber: { type: Number },
    documentId: { type: String },
    documentTypeId: { type: Schema.Types.ObjectId, ref: "DocumentType" },
    documentTypeCode: { type: String },
    isLegacyImport: { type: Boolean, default: false },
    allocatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    allocatedAt: { type: Date, default: Date.now },
    notes: { type: String, default: null },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const DocumentAllocationControlSchema = new Schema<IDocumentAllocationControl>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, unique: true, index: true },
    liveAllocationEnabled: { type: Boolean, default: true },
    startingAllocationValue: { type: Number, default: 1, min: 1 },
    maxDocumentAllocation: { type: Number, default: 50000 },
    currentLiveAllocationCounter: { type: Number, default: 0, min: 0 },
    totalLiveAllocations: { type: Number, default: 0, min: 0 },
    totalLegacyImports: { type: Number, default: 0, min: 0 },
    lastAllocatedAt: { type: Date, default: null },
    allocationHistory: { type: [AllocationLogSchema], default: [] },
    duplicatePreventionEvents: { type: Number, default: 0, min: 0 },
    failedAllocationAttempts: { type: Number, default: 0, min: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const DocumentAllocationControl =
  (mongoose.models.DocumentAllocationControl as mongoose.Model<IDocumentAllocationControl>) ||
  mongoose.model<IDocumentAllocationControl>("DocumentAllocationControl", DocumentAllocationControlSchema);

export default DocumentAllocationControl;
