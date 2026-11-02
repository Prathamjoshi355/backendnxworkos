import mongoose, { Types } from "mongoose";
import User from "../models/User";
import Division from "../models/Division";
import Department from "../models/Department";
import Team from "../models/Team";
import Organization from "../models/Organization";
import NXDocument from "../models/NXDocument";
import DocumentAllocationControl from "../models/DocumentAllocationControl";
import DocumentType from "../models/DocumentType";
import DepartmentTemplate from "../models/DepartmentTemplate";
import PermissionProfile from "../models/PermissionProfile";
import AuditLog from "../models/AuditLog";
import SchedulerLock from "../models/SchedulerLock";
import storageProvider from "./storageService";

export interface SuperAdminDashboardOverview {
  headcount: {
    totalEmployees: number;
    activeEmployees: number;
    interns: number;
    inactiveEmployees: number;
    divisionHeadcount: Array<{ divisionId: string; name: string; count: number }>;
    departmentHeadcount: Array<{ departmentId: string; name: string; count: number }>;
    teamHeadcount: Array<{ teamId: string; name: string; count: number }>;
  };
  documents: {
    totalDocuments: number;
    liveDocuments: number;
    legacyImportedDocuments: number;
    totalTypes: number;
    allocations: any;
  };
  registries: {
    totalDepartmentTemplates: number;
    totalPermissionProfiles: number;
  };
  system: {
    databaseStatus: "CONNECTED" | "DISCONNECTED";
    storageProvider: string;
    storageHealthy: boolean;
    schedulerStatus: "ACTIVE" | "IDLE";
    lastSchedulerRun?: Date | null;
    recentAuditEvents: any[];
  };
}

export async function getSuperAdminControlCenterOverview(
  currentUser: any,
  organizationId?: string
): Promise<SuperAdminDashboardOverview> {
  // SUPER_ADMIN / ADMIN authorization only
  if (currentUser.role !== "SUPER_ADMIN" && currentUser.role !== "ADMIN") {
    throw new Error("FORBIDDEN_ADMIN_ACCESS_REQUIRED: Super Admin Control Center is restricted to authorized platform administrators.");
  }

  const orgFilter: any = {};
  if (currentUser.role === "ADMIN") {
    orgFilter.organizationId = currentUser.organizationId;
  } else if (organizationId) {
    orgFilter.organizationId = new Types.ObjectId(organizationId);
  }

  // 1. Headcount (Independently calculated from Users)
  const [
    totalEmployees,
    activeEmployees,
    interns,
    inactiveEmployees,
  ] = await Promise.all([
    User.countDocuments({ ...orgFilter }),
    User.countDocuments({ ...orgFilter, status: "ACTIVE" }),
    User.countDocuments({ ...orgFilter, employmentType: "INTERN" }),
    User.countDocuments({ ...orgFilter, status: { $in: ["INACTIVE", "TERMINATED", "SUSPENDED"] } }),
  ]);

  // Aggregate headcounts per division, department, team
  const divisionAgg = await User.aggregate([
    { $match: { ...orgFilter, divisionId: { $ne: null } } },
    { $group: { _id: "$divisionId", count: { $sum: 1 } } },
  ]);

  const departmentAgg = await User.aggregate([
    { $match: { ...orgFilter, departmentId: { $ne: null } } },
    { $group: { _id: "$departmentId", count: { $sum: 1 } } },
  ]);

  const teamAgg = await User.aggregate([
    { $match: { ...orgFilter, teamId: { $ne: null } } },
    { $group: { _id: "$teamId", count: { $sum: 1 } } },
  ]);

  const divisionHeadcount = divisionAgg.map((d) => ({
    divisionId: String(d._id),
    name: String(d._id),
    count: d.count,
  }));

  const departmentHeadcount = departmentAgg.map((d) => ({
    departmentId: String(d._id),
    name: String(d._id),
    count: d.count,
  }));

  const teamHeadcount = teamAgg.map((t) => ({
    teamId: String(t._id),
    name: String(t._id),
    count: t.count,
  }));

  // 2. Document Metrics
  const docOrgFilter: any = {};
  if (orgFilter.organizationId) docOrgFilter.organizationId = orgFilter.organizationId;

  const [
    totalDocuments,
    legacyImportedDocuments,
    liveDocuments,
    totalTypes,
  ] = await Promise.all([
    NXDocument.countDocuments(docOrgFilter),
    NXDocument.countDocuments({ ...docOrgFilter, isLegacyImport: true }),
    NXDocument.countDocuments({ ...docOrgFilter, isLegacyImport: false }),
    DocumentType.countDocuments({ status: "ACTIVE" }),
  ]);

  let allocationControl: any = null;
  if (orgFilter.organizationId) {
    allocationControl = await DocumentAllocationControl.findOne({ organizationId: orgFilter.organizationId });
  } else {
    allocationControl = await DocumentAllocationControl.findOne();
    if (!allocationControl) {
      allocationControl = {
        currentLiveAllocationCounter: liveDocuments,
        totalLegacyImports: legacyImportedDocuments,
        totalLiveAllocations: liveDocuments,
        liveAllocationEnabled: true,
      };
    }
  }

  // 3. Registries
  const [totalDepartmentTemplates, totalPermissionProfiles] = await Promise.all([
    DepartmentTemplate.countDocuments({ status: "ACTIVE" }),
    PermissionProfile.countDocuments({ status: "ACTIVE" }),
  ]);

  // 4. System Health & Operational Alerts
  const dbStatus = mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED";
  const storageHealth = await storageProvider.healthCheck();

  const latestLock = await SchedulerLock.findOne().sort({ lockedAt: -1 }).lean();
  const recentAuditEvents = await AuditLog.find(orgFilter.organizationId ? { organizationId: orgFilter.organizationId } : {})
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return {
    headcount: {
      totalEmployees,
      activeEmployees,
      interns,
      inactiveEmployees,
      divisionHeadcount,
      departmentHeadcount,
      teamHeadcount,
    },
    headcounts: {
      totalUsers: totalEmployees,
      totalEmployees,
      activeEmployees,
      interns,
      inactiveEmployees,
      divisionHeadcount,
      departmentHeadcount,
      teamHeadcount,
    },
    documents: {
      totalDocuments,
      liveDocuments,
      legacyImportedDocuments,
      totalTypes,
      allocations: allocationControl,
      allocationState: allocationControl,
      systemRegistries: {
        predefinedCategories: 11,
        predefinedTypes: totalTypes,
      },
    },
    registries: {
      totalDepartmentTemplates,
      totalPermissionProfiles,
    },
    system: {
      databaseStatus: dbStatus,
      storageProvider: storageProvider.providerName,
      storageHealthy: storageHealth.healthy,
      schedulerStatus: latestLock && latestLock.status === "LOCKED" ? "ACTIVE" : "IDLE",
      lastSchedulerRun: latestLock?.lockedAt || null,
      recentAuditEvents,
    },
    systemHealth: {
      database: dbStatus,
      storage: storageHealth.healthy ? "CONNECTED" : "DEGRADED",
    },
  } as any;
}

export const getSuperAdminControlOverview = getSuperAdminControlCenterOverview;
