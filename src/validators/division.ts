import { z } from "zod";
import {
  DIVISION_CODE_REGEX,
  isReservedDivisionIdentity,
} from "../constants/division";

/**
 * Zod validation schema for creating a new Division.
 * Enforces organization assignment, name constraints, reserved entity protection,
 * and 2-6 uppercase alphanumeric division code format.
 */
export const DivisionCreateSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z
    .string()
    .trim()
    .min(2, "Division name must be at least 2 characters")
    .max(100, "Division name cannot exceed 100 characters")
    .refine((val) => !isReservedDivisionIdentity(val), {
      message:
        "The entity 'NX Media' is a reserved corporate entity and cannot be created as an internal division.",
    }),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      DIVISION_CODE_REGEX,
      "Division code must contain 2-6 uppercase alphanumeric characters (^[A-Z0-9]{2,6}$)"
    ),
  description: z.string().trim().max(500, "Description cannot exceed 500 characters").optional().nullable(),
  divisionHeadId: z.string().optional().nullable(),
  budgetCode: z.string().trim().max(50, "Budget code cannot exceed 50 characters").optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

/**
 * Zod validation schema for updating an existing Division.
 * NOTE: organizationId and code are strictly IMMUTABLE through update requests.
 */
export const DivisionUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Division name must be at least 2 characters")
    .max(100, "Division name cannot exceed 100 characters")
    .refine((val) => !isReservedDivisionIdentity(val), {
      message:
        "The entity 'NX Media' is a reserved corporate entity and cannot be created as an internal division.",
    })
    .optional(),
  description: z.string().trim().max(500, "Description cannot exceed 500 characters").optional().nullable(),
  divisionHeadId: z.string().optional().nullable(),
  budgetCode: z.string().trim().max(50, "Budget code cannot exceed 50 characters").optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

export type DivisionCreateInput = z.infer<typeof DivisionCreateSchema>;
export type DivisionUpdateInput = z.infer<typeof DivisionUpdateSchema>;
