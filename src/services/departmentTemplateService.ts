import DepartmentTemplate, { IDepartmentTemplate } from "../models/DepartmentTemplate";
import Department, { IDepartment } from "../models/Department";
import PermissionProfile from "../models/PermissionProfile";
import mongoose, { Types } from "mongoose";

export const GENERIC_DEPARTMENT_CATALOGUE: Array<{
  code: string;
  name: string;
  category: "ENGINEERING" | "BUSINESS" | "OPERATIONS" | "CORPORATE" | "OTHER";
  description: string;
  recommendedRoles: string[];
  recommendedPermissions: string[];
}> = [
  {
    code: "HR",
    name: "HR",
    category: "CORPORATE",
    description: "Human resources, employee lifecycle, onboarding, attendance and leave management",
    recommendedRoles: ["HR_HEAD", "HR_MANAGER", "HR_EXECUTIVE", "HR_RECRUITER"],
    recommendedPermissions: [
      "employee.view.organization",
      "employee.create",
      "employee.update.assigned",
      "attendance.view.organization",
      "attendance.manage",
      "leave.view.team",
      "leave.approve.department",
      "payroll.view.organization",
      "document.view.organization",
      "document.create",
    ],
  },
  {
    code: "FINANCE",
    name: "Finance & Accounts",
    category: "CORPORATE",
    description: "Financial planning, accounting, billing, disbursements and financial reporting",
    recommendedRoles: ["FINANCE_HEAD", "ACCOUNTANT", "FINANCE_EXECUTIVE"],
    recommendedPermissions: [
      "payroll.view.organization",
      "payroll.create",
      "payroll.manage",
      "document.view.organization",
      "document.create",
      "reports.view.organization",
    ],
  },
  {
    code: "SALES",
    name: "Sales & Business Development",
    category: "BUSINESS",
    description: "Client acquisition, enterprise proposals, lead qualification and pipeline closing",
    recommendedRoles: ["SALES_HEAD", "SALES_MANAGER", "SALES_EXECUTIVE", "BUSINESS_DEVELOPMENT_EXECUTIVE"],
    recommendedPermissions: [
      "crm.view.team",
      "crm.create",
      "crm.update.assigned",
      "crm.assign",
      "document.view.department",
      "document.create",
      "reports.view.department",
    ],
  },
  {
    code: "MARKETING",
    name: "Marketing",
    category: "BUSINESS",
    description: "Brand campaigns, digital acquisition, content, social channels and public relations",
    recommendedRoles: ["MARKETING_HEAD", "CONTENT_EXECUTIVE", "SOCIAL_MEDIA_EXECUTIVE", "GRAPHIC_DESIGNER"],
    recommendedPermissions: [
      "project.view.department",
      "document.view.department",
      "document.create",
      "reports.view.department",
    ],
  },
  {
    code: "DEV_CORE",
    name: "Software Development",
    category: "ENGINEERING",
    description: "End-to-end software engineering, architecture, delivery and platform infrastructure",
    recommendedRoles: ["DEVELOPMENT_HEAD", "TECH_LEAD", "SOFTWARE_ENGINEER"],
    recommendedPermissions: [
      "project.view.assigned",
      "project.create",
      "project.update",
      "task.view.team",
      "task.manage",
      "document.view.department",
    ],
  },
  {
    code: "DEV_BACKEND",
    name: "Backend Development",
    category: "ENGINEERING",
    description: "Distributed backends, APIs, databases, message queues and cloud architecture",
    recommendedRoles: ["TECH_LEAD", "BACKEND_DEVELOPER", "DATABASE_ENGINEER"],
    recommendedPermissions: ["project.view.assigned", "task.view.team", "task.manage"],
  },
  {
    code: "DEV_FRONTEND",
    name: "Frontend Development",
    category: "ENGINEERING",
    description: "Web client interfaces, user experience, responsive state management and accessibility",
    recommendedRoles: ["TECH_LEAD", "FRONTEND_DEVELOPER"],
    recommendedPermissions: ["project.view.assigned", "task.view.team", "task.manage"],
  },
  {
    code: "DEV_MOBILE",
    name: "Mobile App Development",
    category: "ENGINEERING",
    description: "Cross-platform mobile applications (Flutter / iOS / Android) and device integrations",
    recommendedRoles: ["TECH_LEAD", "MOBILE_DEVELOPER"],
    recommendedPermissions: ["project.view.assigned", "task.view.team", "task.manage"],
  },
  {
    code: "UI_UX",
    name: "UI/UX Design",
    category: "ENGINEERING",
    description: "User research, product wireframes, interaction design, prototypes and design systems",
    recommendedRoles: ["DESIGN_LEAD", "UI_UX_DESIGNER"],
    recommendedPermissions: ["project.view.assigned", "task.view.team"],
  },
  {
    code: "QA",
    name: "Quality Assurance",
    category: "ENGINEERING",
    description: "Software testing, automated regression, release verification and defect auditing",
    recommendedRoles: ["QA_LEAD", "QA_ENGINEER"],
    recommendedPermissions: ["project.view.assigned", "task.view.team", "task.manage"],
  },
  {
    code: "IT_INFRA",
    name: "IT & Infrastructure",
    category: "OPERATIONS",
    description: "DevOps, cloud hosting, internal networks, hardware workstations and security",
    recommendedRoles: ["IT_HEAD", "DEVOPS_ENGINEER", "SYSADMIN"],
    recommendedPermissions: ["admin.settings.manage", "reports.view.organization"],
  },
  {
    code: "OPERATIONS",
    name: "Operations",
    category: "OPERATIONS",
    description: "Business operational delivery, logistics, vendor management and office operations",
    recommendedRoles: ["OPERATIONS_HEAD", "OPERATIONS_MANAGER", "OPERATIONS_EXECUTIVE"],
    recommendedPermissions: ["document.view.organization", "document.create", "reports.view.department"],
  },
  {
    code: "CUSTOMER_SUPPORT",
    name: "Customer Support",
    category: "BUSINESS",
    description: "Client success, incident ticketing, user onboarding and escalation resolution",
    recommendedRoles: ["SUPPORT_HEAD", "SUPPORT_EXECUTIVE"],
    recommendedPermissions: ["crm.view.team", "crm.update.assigned"],
  },
  {
    code: "PROJECT_MGMT",
    name: "Project Management",
    category: "ENGINEERING",
    description: "Project scheduling, sprint governance, scope change management and milestones",
    recommendedRoles: ["PMO_HEAD", "PROJECT_MANAGER", "SCRUM_MASTER"],
    recommendedPermissions: [
      "project.view.assigned",
      "project.create",
      "project.update",
      "project.assign",
      "task.view.team",
      "task.manage",
    ],
  },
  {
    code: "LEGAL_COMPLIANCE",
    name: "Legal & Compliance",
    category: "CORPORATE",
    description: "Statutory compliance, legal contracts, IP governance and regulatory filings",
    recommendedRoles: ["LEGAL_COUNSEL", "COMPLIANCE_OFFICER"],
    recommendedPermissions: ["document.view.organization", "document.create", "document.archive"],
  },
  {
    code: "ADMINISTRATION",
    name: "Administration",
    category: "CORPORATE",
    description: "General facility administration, assets, corporate vendor relations and supplies",
    recommendedRoles: ["ADMIN_HEAD", "ADMIN_OFFICER"],
    recommendedPermissions: ["admin.departments.manage", "admin.users.manage", "reports.view.organization"],
  },
  {
    code: "PRODUCT_MGMT",
    name: "Product Management",
    category: "ENGINEERING",
    description: "Product roadmap, feature prioritization, customer requirements and telemetry",
    recommendedRoles: ["PRODUCT_HEAD", "PRODUCT_MANAGER"],
    recommendedPermissions: ["project.view.assigned", "project.create", "reports.view.department"],
  },
  {
    code: "R_AND_D",
    name: "Research & Development",
    category: "ENGINEERING",
    description: "Applied research, novel algorithms, prototypes and emerging technology benchmarks",
    recommendedRoles: ["R_AND_D_HEAD", "RESEARCH_SCIENTIST"],
    recommendedPermissions: ["project.view.assigned", "document.view.department"],
  },
];

/**
 * Ensure all 18 generic department templates exist in database.
 */
export async function ensureGenericDepartmentTemplates(): Promise<void> {
  for (const item of GENERIC_DEPARTMENT_CATALOGUE) {
    await DepartmentTemplate.findOneAndUpdate(
      { code: item.code },
      {
        $setOnInsert: {
          code: item.code,
          name: item.name,
          category: item.category,
          description: item.description,
          recommendedRoles: item.recommendedRoles,
          recommendedPermissions: item.recommendedPermissions,
          isPredefined: true,
          isSystemCatalogue: true,
          status: "ACTIVE",
        },
      },
      { upsert: true, new: true }
    );
  }
}

export async function listDepartmentTemplates(): Promise<IDepartmentTemplate[]> {
  await ensureGenericDepartmentTemplates();
  return DepartmentTemplate.find({ status: "ACTIVE" }).sort({ name: 1 });
}

export async function enableGenericDepartmentForOrg(
  currentUser: any,
  templateCodeOrId: string,
  options: {
    divisionId?: string;
    isCentral?: boolean;
    customName?: string;
    departmentHeadId?: string;
  } = {}
): Promise<IDepartment> {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_REQUIRED: User must belong to an organization.");
  }

  let template = await DepartmentTemplate.findOne({ code: templateCodeOrId, status: "ACTIVE" });
  if (!template && Types.ObjectId.isValid(templateCodeOrId)) {
    template = await DepartmentTemplate.findById(templateCodeOrId);
  }

  if (!template) {
    throw new Error(`TEMPLATE_NOT_FOUND: Generic department template '${templateCodeOrId}' not found.`);
  }

  const deptName = (options.customName || template.name).trim();

  // Check if department already exists in organization
  let existing = await Department.findOne({
    organizationId: currentUser.organizationId,
    name: deptName,
  });

  if (existing) {
    return existing;
  }

  // Find linked permission profile if exists
  const profile = await PermissionProfile.findOne({
    departmentCode: template.code,
    status: "ACTIVE",
  });

  const newDept = await Department.create({
    organizationId: currentUser.organizationId,
    divisionId: options.divisionId ? new Types.ObjectId(options.divisionId) : null,
    isCentral: Boolean(options.isCentral),
    name: deptName,
    code: template.code,
    description: template.description,
    departmentHeadId: options.departmentHeadId ? new Types.ObjectId(options.departmentHeadId) : null,
    templateId: template._id,
    permissionProfileId: profile?._id || null,
    isCustom: false,
    status: "ACTIVE",
  });

  return newDept;
}

export const enableDepartmentFromTemplate = enableGenericDepartmentForOrg;
