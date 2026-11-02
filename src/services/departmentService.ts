import Department, { IDepartment } from "../models/Department";
import Organization from "../models/Organization";
import User from "../models/User";
import Team from "../models/Team";
import { Types } from "mongoose";

export const DEFAULT_ORGANIZATION_DEPARTMENTS: Array<{
  name: string;
  code: string;
  description: string;
  isCentral?: boolean;
}> = [
  { name: "Human Resources", code: "HR", description: "Human resources, employee lifecycle, onboarding and talent development", isCentral: true },
  { name: "Sales", code: "SALES", description: "Direct enterprise sales, client outreach and revenue generation", isCentral: false },
  { name: "Marketing", code: "MARKETING", description: "Brand marketing, growth campaigns, public relations and digital strategy", isCentral: false },
  { name: "Business Development", code: "BIZ_DEV", description: "Strategic partnerships, alliances and market expansion", isCentral: false },
  { name: "Finance & Accounts", code: "FIN_ACCTS", description: "Financial planning, accounting, payroll reconciliation and compliance", isCentral: true },
  { name: "Operations", code: "OPERATIONS", description: "Business workflow management, quality systems and operational delivery", isCentral: false },
  { name: "Information Technology", code: "IT", description: "IT infrastructure, software systems, cybersecurity and technical tooling", isCentral: true },
  { name: "Customer Support", code: "SUPPORT", description: "Customer success, onboarding assistance, escalation and service desk", isCentral: false },
  { name: "Administration", code: "ADMIN", description: "Corporate facilities, office infrastructure, asset handover and general operations", isCentral: true },
  { name: "Legal & Compliance", code: "LEGAL_COMP", description: "Corporate law, contracts, IP management and regulatory filings", isCentral: true },
  { name: "Research & Development", code: "R_AND_D", description: "Applied innovation, prototype design and emerging technology exploration", isCentral: false },
  { name: "Procurement & Vendor Management", code: "VENDOR_MGMT", description: "Supply chain, vendor onboarding, contract negotiations and purchasing", isCentral: false },
];

/**
 * Idempotently initialize the 12 pre-built default departments for an organization.
 * Preserves existing configurations, never duplicates, and does not touch employee assignments.
 */
export async function initializeDefaultDepartmentsForOrg(
  organizationId: string | Types.ObjectId,
  options: { divisionId?: string | null; isCentral?: boolean } = {}
): Promise<{ created: IDepartment[]; existing: IDepartment[] }> {
  const org = await Organization.findById(organizationId).lean();
  if (!org) throw new Error("ORG_NOT_FOUND");

  const created: IDepartment[] = [];
  const existing: IDepartment[] = [];

  for (const template of DEFAULT_ORGANIZATION_DEPARTMENTS) {
    // Check if department already exists by exact name in this organization
    const found = await Department.findOne({
      organizationId,
      name: template.name,
    });

    if (found) {
      existing.push(found);
    } else {
      const newDept = await Department.create({
        organizationId,
        divisionId: options.divisionId ? new Types.ObjectId(options.divisionId) : null,
        isCentral: options.isCentral !== undefined ? options.isCentral : Boolean(template.isCentral),
        name: template.name,
        code: template.code,
        description: template.description,
        isCustom: false,
        status: "ACTIVE",
      });
      created.push(newDept);
    }
  }

  return { created, existing };
}

/**
 * Safe department deactivation with dependency verification (Section 4).
 * Blocks deactivation if active users or active teams are assigned to the department.
 */
export async function safeDeactivateDepartment(
  departmentId: string
): Promise<IDepartment> {
  const dept = await Department.findById(departmentId);
  if (!dept) throw new Error("DEPT_NOT_FOUND");

  // Check 1: Active users assigned to this department
  const activeUsersCount = await User.countDocuments({
    $or: [{ departmentId: String(dept._id) }, { departmentId: dept.name }],
    status: "ACTIVE",
  });

  if (activeUsersCount > 0) {
    throw new Error(`DEPARTMENT_HAS_ACTIVE_MEMBERS: Cannot deactivate department '${dept.name}'. It currently has ${activeUsersCount} active employee(s). Reassign them first.`);
  }

  // Check 2: Active teams under this department
  const activeTeamsCount = await Team.countDocuments({
    departmentId: String(dept._id),
    status: "ACTIVE",
  });

  if (activeTeamsCount > 0) {
    throw new Error(`DEPARTMENT_HAS_ACTIVE_TEAMS: Cannot deactivate department '${dept.name}'. It currently has ${activeTeamsCount} active team(s). Archive or reassign teams first.`);
  }

  dept.status = "INACTIVE";
  await dept.save();
  return dept;
}

export async function createDepartment(payload: any) {
  // ensure organization exists
  const org = await Organization.findById(payload.organizationId).lean();
  if (!org) throw new Error("ORG_NOT_FOUND");
  const created = await Department.create(payload);
  return created.toObject();
}

export async function getDepartmentById(id: string) {
  return Department.findById(id).lean();
}

export async function listDepartments(filter: any = {}, opts: any = {}) {
  const { skip = 0, limit = 20 } = opts;
  const items = await Department.find(filter).skip(skip).limit(limit).lean();
  const total = await Department.countDocuments(filter);
  return { items, total };
}

export async function updateDepartment(id: string, payload: any) {
  if (payload.organizationId) {
    const org = await Organization.findById(payload.organizationId).lean();
    if (!org) throw new Error("ORG_NOT_FOUND");
  }
  const updated = await Department.findByIdAndUpdate(id, payload, { new: true }).lean();
  return updated;
}

export async function setDepartmentStatus(id: string, status: string) {
  if (status === "INACTIVE") {
    return safeDeactivateDepartment(id);
  }
  const updated = await Department.findByIdAndUpdate(id, { status }, { new: true }).lean();
  return updated;
}
