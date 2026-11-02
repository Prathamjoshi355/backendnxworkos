import { z } from "zod";

export const BreakStartSchema = z.object({
  type: z.enum(["LUNCH", "SHORT_BREAK", "PERSONAL", "OTHER"]),
});

export const AttendanceFilterSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  organizationId: z.string().optional(),
  userId: z.string().optional(),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
  attendanceStatus: z.enum(["PRESENT", "LATE", "ABSENT", "ON_LEAVE"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
