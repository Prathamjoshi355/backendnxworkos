export const AttendanceStatus = {
  PRESENT: "PRESENT",
  LATE: "LATE",
  ABSENT: "ABSENT",
  ON_LEAVE: "ON_LEAVE",
} as const;

export const AttendanceCurrentStatus = {
  OFFLINE: "OFFLINE",
  ONLINE: "ONLINE",
  ON_BREAK: "ON_BREAK",
  LOGGED_OUT: "LOGGED_OUT",
} as const;

export const WorkSessionStatus = {
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
} as const;

export const BreakType = {
  LUNCH: "LUNCH",
  SHORT_BREAK: "SHORT_BREAK",
  PERSONAL: "PERSONAL",
  OTHER: "OTHER",
} as const;

export const BreakStatus = {
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
} as const;
