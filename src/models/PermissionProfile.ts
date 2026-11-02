import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPermissionProfile extends Document {
  name: string;
  code: string;
  departmentCode?: string;
  targetRole?: string;
  description?: string;
  permissions: string[];
  isPredefined: boolean;
  isSystemPredefined?: boolean;
  organizationId?: Types.ObjectId | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
}

const PermissionProfileSchema = new Schema<IPermissionProfile>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    departmentCode: { type: String, default: null, uppercase: true, trim: true },
    targetRole: { type: String, default: null },
    description: { type: String, default: null },
    permissions: { type: [String], default: [] },
    isPredefined: { type: Boolean, default: false },
    isSystemPredefined: { type: Boolean, default: false },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

PermissionProfileSchema.index({ organizationId: 1, code: 1 }, { unique: true });

export const PermissionProfile =
  (mongoose.models.PermissionProfile as mongoose.Model<IPermissionProfile>) ||
  mongoose.model<IPermissionProfile>("PermissionProfile", PermissionProfileSchema);

export default PermissionProfile;
