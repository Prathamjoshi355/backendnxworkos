import mongoose, { Schema, Document, Types } from "mongoose";

export interface IDocumentCategory extends Document {
  name: string;
  code: string;
  description?: string;
  isPredefined: boolean;
  organizationId?: Types.ObjectId | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
}

const DocumentCategorySchema = new Schema<IDocumentCategory>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, default: null },
    isPredefined: { type: Boolean, default: false },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

DocumentCategorySchema.index({ organizationId: 1, code: 1 }, { unique: true });

export const DocumentCategory =
  (mongoose.models.DocumentCategory as mongoose.Model<IDocumentCategory>) ||
  mongoose.model<IDocumentCategory>("DocumentCategory", DocumentCategorySchema);

export default DocumentCategory;

