import User from "../models/User";
import Department from "../models/Department";
import Team from "../models/Team";
import Organization from "../models/Organization";
import AuditLog from "../models/AuditLog";
import { getSecurityTelemetry } from "./securityCenterService";
import { getSystemHealth } from "./systemHealthService";

export interface ControlCenterQuery {
  user: any;
  targetOrganizationId?: string | null;
}

export async function getControlCenterOverview({ user, targetOrganizationId }: ControlCenterQuery) {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const orgId = isSuperAdmin ? (targetOrganizationId || null) : String(user.organizationId || "");

  const orgFilter: Record<string, unknown> = {};
  if (orgId) {
    orgFilter.organizationId = orgId;
  }

  const [
    totalUsers,
    activeUsers,
    inactiveUsers,
    adminUsers,
    employeeUsers,
    internUsers,
    totalDepartments,
    totalTeams,
    totalOrganizations,
    totalAuditLogs,
    recentAuditLogs,
    securityTelemetry,
    healthStatus,
  ] = await Promise.all([
    User.countDocuments(orgFilter),
    User.countDocuments({ ...orgFilter, status: "ACTIVE" }),
    User.countDocuments({ ...orgFilter, status: { $in: ["INACTIVE", "SUSPENDED", "LOCKED", "TERMINATED"] } }),
    User.countDocuments({ ...orgFilter, role: "ADMIN" }),
    User.countDocuments({ ...orgFilter, employmentType: "EMPLOYEE" }),
    User.countDocuments({ ...orgFilter, employmentType: "INTERN" }),
    Department.countDocuments(orgFilter),
    Team.countDocuments(orgFilter),
    isSuperAdmin ? Organization.countDocuments() : 1,
    AuditLog.countDocuments(orgFilter),
    AuditLog.find(orgFilter)
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("actorId", "fullName email employeeId role")
      .lean(),
    getSecurityTelemetry({ organizationId: orgId, role: user.role }),
    getSystemHealth({ userRole: user.role, organizationId: orgId }),
  ]);

  return {
    overview: {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: inactiveUsers,
        admins: adminUsers,
        employees: employeeUsers,
        interns: internUsers,
      },
      hierarchy: {
        departments: totalDepartments,
        teams: totalTeams,
        organizations: totalOrganizations,
      },
      governance: {
        totalAuditLogs,
        recentAudits: recentAuditLogs,
      },
      security: securityTelemetry.metrics,
      health: {
        status: healthStatus.status,
        uptimeSeconds: healthStatus.system.uptimeSeconds,
        databaseStatus: healthStatus.database.status,
      },
    },
    scope: {
      role: user.role,
      isSuperAdmin,
      organizationId: orgId,
    },
  };
}
