import AuditLog from "../models/AuditLog";
import User from "../models/User";
import Attendance from "../models/Attendance";

export interface SecurityTelemetryQuery {
  organizationId?: string | null;
  role?: string;
}

export async function getSecurityTelemetry(query: SecurityTelemetryQuery) {
  const orgFilter: Record<string, unknown> = {};
  const userOrgFilter: Record<string, unknown> = {};

  if (query.organizationId) {
    orgFilter.organizationId = query.organizationId;
    userOrgFilter.organizationId = query.organizationId;
  }

  // Real security metrics
  const [
    failedLoginsCount,
    lockedAccountsCount,
    activeSessionsCount,
    privilegedUsersCount,
    recentPrivilegedEvents,
    suspendedAccounts,
  ] = await Promise.all([
    AuditLog.countDocuments({
      ...orgFilter,
      action: { $in: ["AUTH_FAILED", "LOGIN_FAILED", "PERMISSION_DENIED"] },
    }),
    User.countDocuments({
      ...userOrgFilter,
      status: { $in: ["INACTIVE", "SUSPENDED", "LOCKED", "TERMINATED"] },
    }),
    Attendance.countDocuments({
      ...orgFilter,
      currentStatus: "ONLINE",
    }),
    User.countDocuments({
      ...userOrgFilter,
      role: { $in: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      status: "ACTIVE",
    }),
    AuditLog.find({
      ...orgFilter,
      action: {
        $in: [
          "ROLE_CHANGED",
          "PERMISSION_CHANGED",
          "ROLE_PROMOTED_MANAGER",
          "ROLE_PROMOTED_TEAM_LEAD",
          "ROLE_DEMOTED_EMPLOYEE",
          "EMPLOYEE_STATUS_CHANGED",
          "ORGANIZATION_UPDATED",
          "SYSTEM_SETTING_UPDATED",
          "USER_CREATED",
          "USER_DELETED",
          "AUTH_FAILED",
          "LOGIN_FAILED",
          "PERMISSION_DENIED",
        ],
      },
    })
      .sort({ createdAt: -1 })
      .limit(25)
      .populate("actorId", "fullName email employeeId role")
      .lean(),
    User.find({
      ...userOrgFilter,
      status: { $in: ["INACTIVE", "SUSPENDED", "LOCKED", "TERMINATED"] },
    })
      .select("_id fullName employeeId email role status updatedAt")
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean(),
  ]);

  return {
    metrics: {
      failedLogins: failedLoginsCount,
      lockedOrSuspendedAccounts: lockedAccountsCount,
      activeSessions: activeSessionsCount,
      privilegedAccounts: privilegedUsersCount,
    },
    recentPrivilegedEvents,
    suspendedAccounts,
    scoping: {
      organizationId: query.organizationId || null,
      isGlobal: !query.organizationId,
    },
  };
}
