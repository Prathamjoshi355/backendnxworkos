import { z } from "zod";

export const EODBlockerInputSchema = z.object({
  blockerId: z.string().optional(),
  title: z.string().min(1, "Blocker title is required"),
  description: z.string().optional().default(""),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional().default("MEDIUM"),
  relatedTaskId: z.string().optional().nullable(),
  resolved: z.boolean().optional().default(false),
  resolvedAt: z.string().optional().nullable(),
});

export const EODReportCreateSchema = z.object({
  reportDate: z.string().optional().nullable(),
  completedTaskIds: z.array(z.string()).optional(),
  inProgressTaskIds: z.array(z.string()).optional(),
  pendingTaskIds: z.array(z.string()).optional(),
  selectedTaskIds: z.array(z.string()).optional(),
  accomplishments: z.string().optional().nullable(),
  challenges: z.string().optional().nullable(),
  additionalRemarks: z.string().optional().nullable(),
  tomorrowPlan: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  completedSummary: z.string().optional().nullable(),
  highlights: z.array(z.string()).optional(),
  achievements: z.array(z.string()).optional(),
  plannedTasks: z.array(z.string()).optional(),
  tomorrowPriority: z.string().optional().nullable(),
  additionalWork: z.string().optional().nullable(),
  blockers: z.array(z.union([z.string(), EODBlockerInputSchema])).optional(),
  status: z
    .enum(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "RETURNED", "REWORK_REQUIRED", "LOCKED", "REVIEWED"])
    .optional(),
  action: z.enum(["SAVE_DRAFT", "SUBMIT", "DRAFT"]).optional(),
});

export const EODReportUpdateSchema = EODReportCreateSchema.partial();

export const EODReportReviewSchema = z.object({
  status: z.enum(["APPROVED", "RETURNED", "REWORK_REQUIRED"]),
  reviewRemarks: z.string().optional().nullable(),
  reviewerRemarks: z.string().optional().nullable(),
  reworkReason: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
});
