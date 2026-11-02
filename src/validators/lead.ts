import { z } from "zod";

export const createLeadValidator = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().min(7, "Phone number is required"),
  email: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().email("Invalid email").optional()),
  company: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  location: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  city: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  state: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  source: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  leadType: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  productId: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  productName: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  priority: z.enum(["HOT", "WARM", "COLD", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("WARM"),
  notes: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  departmentId: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  teamId: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
  assignedTo: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().optional()),
});

export const updateLeadValidator = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  company: z.string().optional(),
  location: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  priority: z.enum(["HOT", "WARM", "COLD", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  source: z.string().optional(),
  leadType: z.string().optional(),
  status: z
    .enum(["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "FOLLOW_UP", "NO_ANSWER", "RESCHEDULED", "REJECTED", "NEGOTIATION", "CONVERTED", "WON", "NOT_INTERESTED", "LOST", "INVALID"])
    .optional(),
  pipelineStage: z
    .enum(["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "FOLLOW_UP", "NO_ANSWER", "RESCHEDULED", "REJECTED", "NEGOTIATION", "CONVERTED", "WON", "LOST"])
    .optional(),
  assignedTo: z.string().optional(),
  rejectionReason: z.string().optional(),
  nextFollowUpAt: z.string().nullable().optional(),
});

export const assignLeadValidator = z.object({
  assignedTo: z.string().min(1, "Assigned user ID is required"),
});

export const logCallValidator = z.object({
  startedAt: z.string().datetime("Invalid start time"),
  endedAt: z.string().datetime("Invalid end time").optional(),
  duration: z.number().int().min(0).optional(),
  outcome: z.enum([
    "CONNECTED",
    "NO_ANSWER",
    "BUSY",
    "SWITCHED_OFF",
    "WRONG_NUMBER",
    "CALLBACK_REQUESTED",
    "INTERESTED",
    "NOT_INTERESTED",
    "CONVERTED",
  ]),
  notes: z.string().optional(),
});

export const createFollowUpValidator = z.object({
  scheduledAt: z.string().datetime("Invalid follow-up time"),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

export const completeFollowUpValidator = z.object({
  notes: z.string().optional(),
});

export const importLeadsValidator = z.object({
  leads: z
    .array(
      z.object({
        name: z.string().min(2),
        phone: z.string().regex(/^\d{10,}$/),
        email: z.string().email().optional(),
        company: z.string().optional(),
        location: z.string().optional(),
        source: z.string().optional(),
        leadType: z.string().optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
      })
    )
    .min(1, "At least one lead is required"),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
});

export const listLeadsQueryValidator = z.object({
  search: z.string().optional(),
  status: z
    .enum(["NEW", "CONTACTED", "INTERESTED", "FOLLOW_UP", "NEGOTIATION", "CONVERTED", "NOT_INTERESTED", "LOST", "INVALID"])
    .optional(),
  pipelineStage: z
    .enum(["NEW", "CONTACTED", "INTERESTED", "FOLLOW_UP", "NEGOTIATION", "CONVERTED", "LOST"])
    .optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedTo: z.string().optional(),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
  source: z.string().optional(),
  leadType: z.string().optional(),
  followUpToday: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadValidator>;
export type UpdateLeadInput = z.infer<typeof updateLeadValidator>;
export type AssignLeadInput = z.infer<typeof assignLeadValidator>;
export type LogCallInput = z.infer<typeof logCallValidator>;
export type CreateFollowUpInput = z.infer<typeof createFollowUpValidator>;
export type ImportLeadsInput = z.infer<typeof importLeadsValidator>;
