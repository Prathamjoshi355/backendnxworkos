import { z } from "zod";

export const CompensationCreateSchema = z.object({
  userId: z.string().min(1, "User is required"),
  compensationType: z.enum(["SALARY", "STIPEND"]),
  baseAmount: z.coerce.number().min(0, "Amount must be greater than or equal to zero"),
  currency: z.string().trim().min(1, "Currency is required").default("INR"),
  payFrequency: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  effectiveFrom: z.string().trim().min(1, "Effective date is required"),
  reason: z.string().trim().max(500).optional(),
});

export const CompensationUpdateSchema = z.object({
  compensationType: z.enum(["SALARY", "STIPEND"]).optional(),
  baseAmount: z.coerce.number().min(0, "Amount must be greater than or equal to zero").optional(),
  currency: z.string().trim().min(1, "Currency is required").optional(),
  payFrequency: z.enum(["MONTHLY", "YEARLY"]).optional(),
  effectiveFrom: z.string().trim().min(1, "Effective date is required").optional(),
  effectiveTo: z.string().trim().min(1, "Effective end date is required").optional(),
  reason: z.string().trim().max(500).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "REVISED"]).optional(),
});

export const CompensationStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "REVISED"]),
});
