import { z } from "zod";

export const DEFAULT_TEMPORARY_PASSWORD = "Nexisparkx@123";

/**
 * Validates password strength policy:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number or special character
 */
export function isStrongPassword(password: string): boolean {
  if (!password || typeof password !== "string" || password.length < 8) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigitOrSpecial = /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  return hasUpper && hasLower && hasDigitOrSpecial;
}

export const RegisterSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.string().optional(),
  employmentType: z.string().optional(),
});

export const LoginSchema = z.object({
  email: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  emailOrEmployeeId: z.string().min(1).optional(),
  password: z.string().min(1),
}).refine((value) => Boolean(value.emailOrEmployeeId || value.email || value.employeeId), {
  message: "Email or employee ID is required",
  path: ["emailOrEmployeeId"],
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Confirm password is required"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "New password and confirmation do not match",
  path: ["confirmPassword"],
}).refine((data) => isStrongPassword(data.newPassword), {
  message: "New password must contain uppercase, lowercase, and a number or special character",
  path: ["newPassword"],
});
