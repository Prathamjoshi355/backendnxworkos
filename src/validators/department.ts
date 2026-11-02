import { z } from "zod";

export const DepartmentCreateSchema = z.object({
  organizationId: z.string().min(1),
  divisionId: z.string().nullable().optional(),
  isCentral: z.boolean().optional(),
  name: z.string().min(1),
  code: z.string().optional(),
  description: z.string().optional(),
  departmentHeadId: z.string().optional(),
});

export const DepartmentUpdateSchema = DepartmentCreateSchema.partial();
