import mongoose, { Schema, Document } from "mongoose";

export interface IDepartmentTemplate extends Document {
  code: string;
  name: string;
  description?: string;
  category: "ENGINEERING" | "BUSINESS" | "OPERATIONS" | "CORPORATE" | "OTHER";
  recommendedRoles: string[];
  recommendedPermissions: string[];
  isPredefined: boolean;
  isSystemCatalogue?: boolean;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
}

const DepartmentTemplateSchema = new Schema<IDepartmentTemplate>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    category: {
      type: String,
      enum: ["ENGINEERING", "BUSINESS", "OPERATIONS", "CORPORATE", "OTHER"],
      default: "CORPORATE",
    },
    recommendedRoles: { type: [String], default: [] },
    recommendedPermissions: { type: [String], default: [] },
    isPredefined: { type: Boolean, default: true },
    isSystemCatalogue: { type: Boolean, default: true },
    status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE" },
  },
  { timestamps: true }
);

export const DepartmentTemplate =
  (mongoose.models.DepartmentTemplate as mongoose.Model<IDepartmentTemplate>) ||
  mongoose.model<IDepartmentTemplate>("DepartmentTemplate", DepartmentTemplateSchema);

export default DepartmentTemplate;
