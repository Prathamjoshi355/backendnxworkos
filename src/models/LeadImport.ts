import mongoose, { Schema } from "mongoose";

export interface ILeadImport extends mongoose.Document {
  importId: string;
  uploadedBy: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  departmentId?: string | null;
  teamId?: string | null;
  filename: string;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  duplicateRows: number;
  fileUrl?: string | null;
  importErrors?: Array<{ rowNumber: number; error: string; data?: any }>;
  createdAt?: Date;
  updatedAt?: Date;
}

const LeadImportSchema = new Schema<ILeadImport>(
  {
    importId: { type: String, required: true, unique: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    departmentId: { type: String, default: null },
    teamId: { type: String, default: null },
    filename: { type: String, required: true },
    totalRows: { type: Number, required: true },
    successfulRows: { type: Number, required: true },
    failedRows: { type: Number, required: true },
    duplicateRows: { type: Number, required: true },
    fileUrl: { type: String, default: null },
    importErrors: {
      type: [
        {
          rowNumber: Number,
          error: String,
          data: Schema.Types.Mixed,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Performance indexes
LeadImportSchema.index({ organizationId: 1, createdAt: -1 });
LeadImportSchema.index({ uploadedBy: 1, createdAt: -1 });

export const LeadImport =
  (mongoose.models.LeadImport as mongoose.Model<ILeadImport>) ||
  mongoose.model<ILeadImport>("LeadImport", LeadImportSchema);

export default LeadImport;
