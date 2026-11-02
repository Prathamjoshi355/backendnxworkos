import mongoose, { Schema } from "mongoose";

export type ProjectStatus = "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type ProjectPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface IProject extends mongoose.Document {
  projectId: string;
  organizationId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  isCrossDivision?: boolean;
  collaboratingDivisionIds?: (mongoose.Types.ObjectId | string)[];
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  name: string;
  code: string;
  description?: string | null;
  ownerId: mongoose.Types.ObjectId | string;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate?: Date | null;
  dueDate?: Date | null;
  progress: number;
  members: (mongoose.Types.ObjectId | string)[];
  createdBy: mongoose.Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    projectId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    isCrossDivision: { type: Boolean, default: false, index: true },
    collaboratingDivisionIds: [{ type: Schema.Types.ObjectId, ref: "Division" }],
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null, index: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    description: { type: String, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"], default: "PLANNED", index: true },
    priority: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], default: "MEDIUM" },
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    progress: { type: Number, default: 0 },
    members: [{ type: Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ProjectSchema.index({ organizationId: 1, status: 1 });
ProjectSchema.index({ members: 1 });
ProjectSchema.index({ organizationId: 1, divisionId: 1 });

export const Project = (mongoose.models.Project as mongoose.Model<IProject>) || mongoose.model<IProject>("Project", ProjectSchema);
export default Project;
