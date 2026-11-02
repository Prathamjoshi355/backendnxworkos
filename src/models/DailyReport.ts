import mongoose, { Schema } from "mongoose";

export type DailyReportStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "TEAM_LEAD_REVIEW"
  | "MANAGER_REVIEW"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "RETURNED"
  | "REWORK_REQUIRED"
  | "RESUBMITTED"
  | "REJECTED"
  | "LOCKED"
  | "REVIEWED";

export type BlockerSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface IEODBlocker {
  blockerId: string;
  title?: string;
  description: string;
  category?: string;
  dependency?: string;
  severity: BlockerSeverity;
  relatedTaskId?: mongoose.Types.ObjectId | string | null;
  createdAt: Date;
  resolved: boolean;
  resolvedAt?: Date | null;
}

export function normalizeBlockers(rawBlockers: any): IEODBlocker[] {
  if (!rawBlockers || !Array.isArray(rawBlockers)) return [];
  return rawBlockers
    .filter((b) => b !== null && b !== undefined)
    .map((b: any, idx: number) => {
      if (typeof b === "string") {
        return {
          blockerId: `BLK-${Date.now()}-${idx + 1}`,
          title: b,
          description: "",
          category: "GENERAL",
          dependency: "",
          severity: "MEDIUM" as BlockerSeverity,
          relatedTaskId: null,
          createdAt: new Date(),
          resolved: false,
          resolvedAt: null,
        };
      }
      return {
        blockerId: b.blockerId || `BLK-${Date.now()}-${idx + 1}`,
        title: String(b.title || b.description || `Blocker ${idx + 1}`),
        description: String(b.description || ""),
        category: b.category || "GENERAL",
        dependency: b.dependency || "",
        severity: (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(b.severity)
          ? b.severity
          : "MEDIUM") as BlockerSeverity,
        relatedTaskId:
          b.relatedTaskId && mongoose.Types.ObjectId.isValid(b.relatedTaskId)
            ? b.relatedTaskId
            : null,
        createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
        resolved: Boolean(b.resolved),
        resolvedAt: b.resolved ? (b.resolvedAt ? new Date(b.resolvedAt) : new Date()) : null,
      };
    });
}

export interface IReviewHistoryItem {
  reviewerId: mongoose.Types.ObjectId | string;
  reviewerRole?: string | null;
  action: string;
  comment?: string | null;
  score?: number | null;
  createdAt: Date;
}

export interface IDailyReport extends mongoose.Document {
  reportId?: string | null;
  userId: mongoose.Types.ObjectId | string;
  employeeId?: mongoose.Types.ObjectId | string | null;
  organizationId: mongoose.Types.ObjectId | string;
  departmentId?: mongoose.Types.ObjectId | string | null;
  teamId?: mongoose.Types.ObjectId | string | null;
  managerId?: mongoose.Types.ObjectId | string | null;
  teamLeadId?: mongoose.Types.ObjectId | string | null;
  reportDate: Date;
  completedTaskIds?: (mongoose.Types.ObjectId | string)[];
  inProgressTaskIds?: (mongoose.Types.ObjectId | string)[];
  pendingTaskIds?: (mongoose.Types.ObjectId | string)[];
  totalTasksWorked: number;
  totalTasksAssigned: number;
  totalTasksCompleted: number;
  totalTasksInProgress: number;
  totalTasksPending: number;
  totalTasksRejected: number;
  totalTasksReworked: number;
  totalEstimatedMinutes: number;
  totalActualMinutes: number;
  completionPercentage: number;
  completedTasks: number;
  pendingTasks: number;
  totalWorkedMinutes: number;
  totalTrackedMinutes: number;
  productiveMinutes: number;
  idleMinutes: number;
  estimatedTaskMinutes: number;
  actualTaskMinutes: number;
  taskWorkedMinutes: number;
  attendanceMinutes: number;
  breakMinutes: number;
  attendanceStatus?: string;
  checkInTime?: Date | null;
  checkOutTime?: Date | null;
  blockerCount: number;
  blockers: IEODBlocker[];
  workSummary?: string | null;
  employeeSummary?: string | null;
  accomplishments?: string | null;
  challenges?: string | null;
  nextDayPlan?: string | null;
  additionalRemarks?: string | null;
  tomorrowPlan?: string | null;
  summary?: string | null;
  highlights?: string[];
  plannedTasks?: string[];
  completedSummary?: string | null;
  achievements?: string[];
  additionalWork?: string | null;
  tomorrowPriority?: string | null;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksSubmitted: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksRejectedForRework: number;
  tasksApproved: number;
  tasksRework: number;
  tasksPending: number;
  tasksOverdue: number;
  tasksCarriedForward: number;
  performanceScore: number;
  teamLeadReviewedBy?: mongoose.Types.ObjectId | string | null;
  teamLeadReviewedAt?: Date | null;
  teamLeadRemarks?: string | null;
  teamLeadScore?: number | null;
  managerReviewedBy?: mongoose.Types.ObjectId | string | null;
  managerReviewedAt?: Date | null;
  managerRemarks?: string | null;
  managerScore?: number | null;
  finalScore?: number | null;
  finalRemarks?: string | null;
  finalizedAt?: Date | null;
  reviewerRemarks?: string | null;
  reviewRemarks?: string | null;
  reworkReason?: string | null;
  reviewerRole?: string | null;
  reviewerComment?: string | null;
  employeeSubmittedAt?: Date | null;
  reviewHistory: IReviewHistoryItem[];
  status: DailyReportStatus;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: mongoose.Types.ObjectId | string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewHistorySchema = new Schema<IReviewHistoryItem>(
  {
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewerRole: { type: String, default: null },
    action: { type: String, required: true },
    comment: { type: String, default: null },
    score: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const EODBlockerSchema = new Schema<IEODBlocker>(
  {
    blockerId: { type: String, required: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    category: { type: String, default: "GENERAL" },
    dependency: { type: String, default: "" },
    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },
    relatedTaskId: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    createdAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
  },
  { _id: false }
);

const DailyReportSchema = new Schema<IDailyReport>(
  {
    reportId: { type: String, index: true, sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null, index: true },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    teamLeadId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reportDate: { type: Date, required: true, index: true },
    completedTaskIds: [{ type: Schema.Types.ObjectId, ref: "Task" }],
    inProgressTaskIds: [{ type: Schema.Types.ObjectId, ref: "Task" }],
    pendingTaskIds: [{ type: Schema.Types.ObjectId, ref: "Task" }],
    totalTasksWorked: { type: Number, default: 0 },
    totalTasksAssigned: { type: Number, default: 0 },
    totalTasksCompleted: { type: Number, default: 0 },
    totalTasksInProgress: { type: Number, default: 0 },
    totalTasksPending: { type: Number, default: 0 },
    totalTasksRejected: { type: Number, default: 0 },
    totalTasksReworked: { type: Number, default: 0 },
    totalEstimatedMinutes: { type: Number, default: 0 },
    totalActualMinutes: { type: Number, default: 0 },
    completionPercentage: { type: Number, default: 0 },
    completedTasks: { type: Number, default: 0 },
    pendingTasks: { type: Number, default: 0 },
    totalWorkedMinutes: { type: Number, default: 0 },
    totalTrackedMinutes: { type: Number, default: 0 },
    productiveMinutes: { type: Number, default: 0 },
    idleMinutes: { type: Number, default: 0 },
    estimatedTaskMinutes: { type: Number, default: 0 },
    actualTaskMinutes: { type: Number, default: 0 },
    taskWorkedMinutes: { type: Number, default: 0 },
    attendanceMinutes: { type: Number, default: 0 },
    breakMinutes: { type: Number, default: 0 },
    attendanceStatus: { type: String, default: "UNKNOWN" },
    checkInTime: { type: Date, default: null },
    checkOutTime: { type: Date, default: null },
    blockerCount: { type: Number, default: 0 },
    blockers: { type: [EODBlockerSchema], default: [] },
    workSummary: { type: String, default: null },
    employeeSummary: { type: String, default: null },
    accomplishments: { type: String, default: null },
    challenges: { type: String, default: null },
    nextDayPlan: { type: String, default: null },
    additionalRemarks: { type: String, default: null },
    tomorrowPlan: { type: String, default: null },
    summary: { type: String, default: null },
    highlights: { type: [String], default: [] },
    plannedTasks: { type: [String], default: [] },
    completedSummary: { type: String, default: null },
    achievements: { type: [String], default: [] },
    additionalWork: { type: String, default: null },
    tomorrowPriority: { type: String, default: null },
    tasksAssigned: { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },
    tasksSubmitted: { type: Number, default: 0 },
    tasksInProgress: { type: Number, default: 0 },
    tasksBlocked: { type: Number, default: 0 },
    tasksRejectedForRework: { type: Number, default: 0 },
    tasksApproved: { type: Number, default: 0 },
    tasksRework: { type: Number, default: 0 },
    tasksPending: { type: Number, default: 0 },
    tasksOverdue: { type: Number, default: 0 },
    tasksCarriedForward: { type: Number, default: 0 },
    performanceScore: { type: Number, default: 0 },
    teamLeadReviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    teamLeadReviewedAt: { type: Date, default: null },
    teamLeadRemarks: { type: String, default: null },
    teamLeadScore: { type: Number, default: null },
    managerReviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    managerReviewedAt: { type: Date, default: null },
    managerRemarks: { type: String, default: null },
    managerScore: { type: Number, default: null },
    finalScore: { type: Number, default: null },
    finalRemarks: { type: String, default: null },
    finalizedAt: { type: Date, default: null },
    reviewerRemarks: { type: String, default: null },
    reviewRemarks: { type: String, default: null },
    reworkReason: { type: String, default: null },
    reviewerRole: { type: String, default: null },
    reviewerComment: { type: String, default: null },
    employeeSubmittedAt: { type: Date, default: null },
    reviewHistory: { type: [ReviewHistorySchema], default: [] },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "SUBMITTED",
        "TEAM_LEAD_REVIEW",
        "MANAGER_REVIEW",
        "UNDER_REVIEW",
        "APPROVED",
        "RETURNED",
        "REWORK_REQUIRED",
        "RESUBMITTED",
        "REJECTED",
        "LOCKED",
        "REVIEWED",
      ],
      default: "DRAFT",
      index: true,
    },
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

DailyReportSchema.pre("save", function (next) {
  if (this.userId && !this.employeeId) {
    this.employeeId = this.userId;
  } else if (this.employeeId && !this.userId) {
    this.userId = this.employeeId;
  }
  next();
});

DailyReportSchema.index({ organizationId: 1, userId: 1, reportDate: 1 }, { unique: true });
DailyReportSchema.index({ organizationId: 1, employeeId: 1, reportDate: 1 });
DailyReportSchema.index({ userId: 1, reportDate: 1 });
DailyReportSchema.index({ organizationId: 1, reportDate: -1 });
DailyReportSchema.index({ organizationId: 1, teamId: 1, reportDate: -1 });
DailyReportSchema.index({ organizationId: 1, managerId: 1, reportDate: -1 });
DailyReportSchema.index({ organizationId: 1, teamLeadId: 1, reportDate: -1 });
DailyReportSchema.index({ organizationId: 1, status: 1, reportDate: -1 });

export const DailyReport =
  (mongoose.models.DailyReport as mongoose.Model<IDailyReport>) ||
  mongoose.model<IDailyReport>("DailyReport", DailyReportSchema);

export const EODReport = DailyReport;
export type IEODReport = IDailyReport;
export type EODReportStatus = DailyReportStatus;

export default DailyReport;


