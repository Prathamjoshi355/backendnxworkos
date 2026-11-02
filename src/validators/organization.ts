import { z } from "zod";

export const OrganizationCreateSchema = z.object({
  name: z.string().min(1),
  legalName: z.string().optional(),
  logo: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  workingHours: z
    .object({
      workStartTime: z.string().optional(),
      workEndTime: z.string().optional(),
      gracePeriodMinutes: z.number().optional(),
      workingDays: z.array(z.string()).optional(),
    })
    .optional(),
  settings: z
    .object({
      dailyReportRequiredBeforeLogout: z.boolean().optional(),
    })
    .optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const OrganizationUpdateSchema = OrganizationCreateSchema.partial();
