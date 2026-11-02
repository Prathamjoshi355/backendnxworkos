import { z } from "zod";

export const TeamCreateSchema = z.object({
  organizationId: z.string().min(1),
  departmentId: z.string().min(1),
  divisionId: z.string().nullable().optional(),
  name: z.string().min(1),
  code: z.string().optional(),
  description: z.string().optional(),
  managerId: z.string().nullable().optional(),
  teamLeadId: z.string().nullable().optional(),
});

export const TeamUpdateSchema = TeamCreateSchema.partial();
