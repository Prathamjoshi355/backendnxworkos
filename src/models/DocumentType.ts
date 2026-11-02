import mongoose, { Schema, Document, Types } from "mongoose";

export interface IDocumentType extends Document {
  name: string;
  code: string; // Exactly 3 digits, 1-9 only (no 0 allowed), globally unique & immutable
  categoryId: Types.ObjectId;
  description?: string;
  hasFinancials: boolean;
  isPredefined: boolean;
  organizationId?: Types.ObjectId | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
}

const DocumentTypeSchema = new Schema<IDocumentType>(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v: string) {
          // Exactly 3 digits, each digit between 1 and 9, no zero allowed
          return /^[1-9]{3}$/.test(v);
        },
        message: (props: any) =>
          `Invalid Document Type Code '${props.value}': Must be exactly three digits between 1-9 with no zero (e.g. 512, 749, 286).`,
      },
      immutable: true, // Immutable once assigned
    },
    categoryId: { type: Schema.Types.ObjectId, ref: "DocumentCategory", required: true, index: true },
    description: { type: String, default: null },
    hasFinancials: { type: Boolean, default: false },
    isPredefined: { type: Boolean, default: false },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

// Global uniqueness for 3-digit code across all document types (even archived ones)
DocumentTypeSchema.index({ code: 1 }, { unique: true });
DocumentTypeSchema.index({ organizationId: 1, name: 1 });

export const DocumentType =
  (mongoose.models.DocumentType as mongoose.Model<IDocumentType>) ||
  mongoose.model<IDocumentType>("DocumentType", DocumentTypeSchema);

export default DocumentType;

