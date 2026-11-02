import { z } from "zod";

export const TaskCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  organizationId: z.string().optional(),
  divisionId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  crmRecordId: z.string().optional().nullable(),
  assignedTo: z.string().min(1),
  assignedBy: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  category: z.string().optional(),
  status: z.enum(["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK", "COMPLETED", "CANCELLED", "OVERDUE"]).optional(),
  startDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  estimatedMinutes: z.number().min(0).optional(),
  actualMinutes: z.number().min(0).optional(),
  creditPoints: z.number().min(0).optional(),
  completionPercentage: z.number().min(0).max(100).optional(),
  completionNote: z.string().optional().nullable(),
  rejectionReason: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
});

export const TaskUpdateSchema = TaskCreateSchema.partial();

export const DailyReportCreateSchema = z.object({
  summary: z.string().min(1).optional().nullable(),
  completedSummary: z.string().min(1).optional().nullable(),
  highlights: z.array(z.string()).optional(),
  blockers: z.array(z.union([z.string(), z.record(z.string(), z.any())])).optional(),
  plannedTasks: z.array(z.string()).optional(),
  completedTasks: z.union([z.number(), z.array(z.string())]).optional(),
  achievements: z.array(z.string()).optional(),
  additionalWork: z.string().optional().nullable(),
  tomorrowPriority: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "SUBMITTED", "REVIEWED", "APPROVED", "REWORK_REQUIRED", "REJECTED"]).optional(),
  rejectedReason: z.string().optional().nullable(),
}).refine((data) => !!(data.summary || data.completedSummary), {
  message: "Summary is required",
  path: ["summary"],
});
