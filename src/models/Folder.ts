import mongoose, { Schema } from "mongoose";

export interface IFolder extends mongoose.Document {
  folderId: string;
  organizationId: mongoose.Types.ObjectId | string;
  name: string;
  parentFolderId?: mongoose.Types.ObjectId | string | null;
  ownerId: mongoose.Types.ObjectId | string;
  category: string;
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  isSystem: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new Schema<IFolder>(
  {
    folderId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    parentFolderId: { type: Schema.Types.ObjectId, ref: "Folder", default: null, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, default: "GENERAL", index: true },
    status: {
      type: String,
      enum: ["ACTIVE", "ARCHIVED", "DELETED"],
      default: "ACTIVE",
      index: true,
    },
    isSystem: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

FolderSchema.index({ organizationId: 1, parentFolderId: 1 });
FolderSchema.index({ organizationId: 1, name: 1 });
FolderSchema.index({ organizationId: 1, status: 1 });

export const Folder =
  (mongoose.models.Folder as mongoose.Model<IFolder>) ||
  mongoose.model<IFolder>("Folder", FolderSchema);

export default Folder;
