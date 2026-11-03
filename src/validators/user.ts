import { z } from "zod";

const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : val),
    z.enum(values).optional()
  );

const optionalString = () =>
  z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : typeof val === "string" ? val.trim() : val),
    z.string().optional()
  );

const optionalEmail = () =>
  z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : typeof val === "string" ? val.trim() : val),
    z.string().email().optional()
  );

export const UserCreateSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  firstName: optionalString(),
  middleName: optionalString(),
  lastName: optionalString(),
  displayName: optionalString(),
  email: z.string().email("Valid email is required"),
  phone: optionalString(),
  personalEmail: optionalEmail(),
  officialEmail: optionalEmail(),
  primaryPhone: optionalString(),
  alternatePhone: optionalString(),
  dateOfBirth: optionalString(),
  gender: optionalEnum(["MALE", "FEMALE", "OTHER"]),
  maritalStatus: optionalEnum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "OTHER"]),
  currentAddress: optionalString(),
  permanentAddress: optionalString(),
  city: optionalString(),
  state: optionalString(),
  country: optionalString(),
  postalCode: optionalString(),
  emergencyContactName: optionalString(),
  emergencyContactRelation: optionalString(),
  emergencyContactPhone: optionalString(),
  emergencyContactAlternatePhone: optionalString(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  employmentType: optionalEnum(["EMPLOYEE", "INTERN"]),
  employmentClassification: optionalEnum(["FULL_TIME_EMPLOYEE", "PART_TIME_EMPLOYEE", "FULL_TIME_INTERN", "PART_TIME_INTERN"]),
  employmentStatus: optionalEnum(["INVITED", "ACTIVE", "PROBATION", "CONFIRMED", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED", "INACTIVE", "TERMINATED", "RESIGNED", "EXITED", "COMPLETED"]),
  role: optionalString(),
  organizationId: optionalString(),
  divisionId: optionalString(),
  primaryDivisionId: optionalString(),
  departmentId: optionalString(),
  teamId: optionalString(),
  designation: optionalString(),
  joiningDate: optionalString(),
  internshipStartDate: optionalString(),
  internshipEndDate: optionalString(),
  evaluationPeriodMonths: z.number().optional().nullable(),
  provisionStipend: z.number().optional().nullable(),
  confirmedStipend: z.number().optional().nullable(),
  confirmedStipendEffectiveDate: optionalString(),
  probationEndDate: optionalString(),
  confirmationDate: optionalString(),
  reportingManagerId: optionalString(),
  workLocation: optionalString(),
  workMode: optionalEnum(["REMOTE", "HYBRID", "OFFICE"]),
  profilePhoto: optionalString(),
  status: optionalEnum(["INVITED", "ACTIVE", "PROBATION", "CONFIRMED", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED", "INACTIVE", "TERMINATED", "RESIGNED", "EXITED", "COMPLETED"]),
});

export const UserUpdateSchema = UserCreateSchema.partial();
