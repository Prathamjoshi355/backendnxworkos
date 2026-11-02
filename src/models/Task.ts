import mongoose, { Schema } from "mongoose";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskStatus =
  | "ASSIGNED"
  | "TODO"
  | "IN_PROGRESS"
  | "PAUSED"
  | "REVIEW"
  | "REWORK"
  | "COMPLETED"
  | "CANCELLED"
  | "OVERDUE";

export interface ITask extends mongoose.Document {
  taskId: string;
  title: string;
  description?: string | null;
  organizationId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  managerId?: mongoose.Types.ObjectId | string | null;
  teamLeadId?: mongoose.Types.ObjectId | string | null;
  projectId?: mongoose.Types.ObjectId | string | null;
  leadId?: mongoose.Types.ObjectId | string | null;
  contactId?: mongoose.Types.ObjectId | string | null;
  crmRecordId?: string | null;
  assignedTo: mongoose.Types.ObjectId | string;
  assignedBy: mongoose.Types.ObjectId | string;
  createdBy?: mongoose.Types.ObjectId | string | null;
  priority: TaskPriority;
  category?: string | null;
  status: TaskStatus;
  startDate?: Date | null;
  dueDate?: Date | null;
  estimatedMinutes: number;
  actualMinutes: number;
  creditPoints: number;
  completionPercentage: number;
  completionNote?: string | null;
  rejectionReason?: string | null;
  tags: string[];
  attachments: string[];
  submittedAt?: Date | null;
  completedAt?: Date | null;
  approvedAt?: Date | null;
  cancelledAt?: Date | null;
  reviewedBy?: mongoose.Types.ObjectId | string | null;
  reviewedAt?: Date | null;
  assignmentHistory?: Array<{
    assignedTo: mongoose.Types.ObjectId | string;
    assignedBy: mongoose.Types.ObjectId | string;
    teamId?: mongoose.Types.ObjectId | string | null;
    managerId?: mongoose.Types.ObjectId | string | null;
    teamLeadId?: mongoose.Types.ObjectId | string | null;
    reassignedAt: Date;
    reason?: string | null;
  }>;
  remarks?: Array<{
    userId: mongoose.Types.ObjectId | string;
    userName?: string;
    userRole?: string;
    comment: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null, index: true },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    teamLeadId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    projectId: { type: Schema.Types.ObjectId, default: null },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    contactId: { type: Schema.Types.ObjectId, default: null },
    crmRecordId: { type: String, default: null, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    priority: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], default: "MEDIUM" },
    category: { type: String, default: "GENERAL" },
    status: { type: String, enum: ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK", "COMPLETED", "CANCELLED", "OVERDUE"], default: "ASSIGNED", index: true },
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    estimatedMinutes: { type: Number, default: 0 },
    actualMinutes: { type: Number, default: 0 },
    creditPoints: { type: Number, default: 0 },
    completionPercentage: { type: Number, default: 0 },
    completionNote: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    tags: { type: [String], default: [] },
    attachments: { type: [String], default: [] },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    assignmentHistory: {
      type: [
        {
          assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
          assignedBy: { type: Schema.Types.ObjectId, ref: "User" },
          teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
          managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
          teamLeadId: { type: Schema.Types.ObjectId, ref: "User", default: null },
          reassignedAt: { type: Date, default: Date.now },
          reason: { type: String, default: null },
        },
      ],
      default: [],
    },
    remarks: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: "User" },
          userName: { type: String, default: null },
          userRole: { type: String, default: null },
          comment: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

TaskSchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
TaskSchema.index({ organizationId: 1, dueDate: 1 });
TaskSchema.index({ organizationId: 1, assignedTo: 1, status: 1 });
TaskSchema.index({ organizationId: 1, teamId: 1, status: 1 });
TaskSchema.index({ organizationId: 1, managerId: 1, status: 1 });
TaskSchema.index({ organizationId: 1, teamLeadId: 1, status: 1 });
TaskSchema.index({ departmentId: 1, teamId: 1, status: 1 });
TaskSchema.index({ organizationId: 1, assignedBy: 1 });
TaskSchema.index({ assignedBy: 1 });
TaskSchema.index({ organizationId: 1, divisionId: 1 });
TaskSchema.index({ organizationId: 1, leadId: 1 });

export const Task = (mongoose.models.Task as mongoose.Model<ITask>) || mongoose.model<ITask>("Task", TaskSchema);
export default Task;
