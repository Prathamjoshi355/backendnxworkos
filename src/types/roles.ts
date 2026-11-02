export const EmploymentType = {
  EMPLOYEE: "EMPLOYEE",
  INTERN: "INTERN",
} as const;

export type EmploymentType = typeof EmploymentType[keyof typeof EmploymentType];

export const Role = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  DIVISION_ADMIN: "DIVISION_ADMIN",
  MANAGER: "MANAGER",
  TEAM_LEADER: "TEAM_LEADER",
  EMPLOYEE: "EMPLOYEE",
  INTERN: "INTERN",
  DESIGNER: "DESIGNER",
  SALES_EXECUTIVE: "SALES_EXECUTIVE",
  MARKETING: "MARKETING",
  DEVELOPER: "DEVELOPER",
  HR: "HR",
} as const;

export type Role = typeof Role[keyof typeof Role];
