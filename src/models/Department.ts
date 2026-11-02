import mongoose, { Schema } from "mongoose";

export interface IDepartment extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  isCentral?: boolean;
  name: string;
  code?: string | null;
  description?: string | null;
  departmentHeadId?: mongoose.Types.ObjectId | string | null;
  templateId?: mongoose.Types.ObjectId | null;
  isCustom?: boolean;
  permissionProfileId?: mongoose.Types.ObjectId | null;
  status: string;
}

const DepartmentSchema = new Schema<IDepartment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    isCentral: { type: Boolean, default: false, index: true },
    name: { type: String, required: true },
    code: { type: String, default: null },
    description: { type: String, default: null },
    departmentHeadId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    templateId: { type: Schema.Types.ObjectId, ref: "DepartmentTemplate", default: null },
    isCustom: { type: Boolean, default: false },
    permissionProfileId: { type: Schema.Types.ObjectId, ref: "PermissionProfile", default: null },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  },
  { timestamps: true }
);

DepartmentSchema.index({ organizationId: 1, name: 1 }, { unique: true, partialFilterExpression: { name: { $exists: true } } });
DepartmentSchema.index({ organizationId: 1, divisionId: 1 });
DepartmentSchema.index({ organizationId: 1, isCentral: 1 });

export const Department = (mongoose.models.Department as mongoose.Model<IDepartment>) || mongoose.model<IDepartment>("Department", DepartmentSchema);
export default Department;
