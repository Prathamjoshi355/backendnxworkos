import mongoose, { Types } from "mongoose";
import PermissionProfile, { IPermissionProfile } from "../models/PermissionProfile";
import User, { IUser } from "../models/User";
import { DivisionAuthError } from "../utils/divisionAuth";

// ---------------------------------------------------------------------------
// 1. Master Granular Permission Catalogue
// ---------------------------------------------------------------------------

export const MASTER_PERMISSION_CATALOGUE = [
  // Employee
  "employee.view.self",
  "employee.view.department",
  "employee.view.organization",
  "employee.create",
  "employee.update.assigned",
  "employee.archive",

  // Attendance
  "attendance.view.self",
  "attendance.view.team",
  "attendance.view.department",
  "attendance.view.organization",
  "attendance.manage",
  "attendance.correct",
  "attendance.export",

  // Leave
  "leave.apply.self",
  "leave.view.self",
  "leave.view.team",
  "leave.approve.team",
  "leave.approve.department",
  "leave.manage",

  // Payroll
  "payroll.view.self",
  "payroll.view.department",
  "payroll.view.organization",
  "payroll.create",
  "payroll.manage",
  "payroll.export",

  // CRM
  "crm.view.assigned",
  "crm.view.team",
  "crm.view.department",
  "crm.create",
  "crm.update.assigned",
  "crm.assign",
  "crm.export",

  // Projects
  "project.view.assigned",
  "project.view.department",
  "project.create",
  "project.update",
  "project.assign",
  "project.archive",

  // Documents
  "document.view",
  "document.view.own",
  "document.view.shared",
  "document.view.department",
  "document.view.division",
  "document.view.organization",
  "document.create",
  "document.update.own",
  "document.update.assigned",
  "document.upload",
  "document.download",
  "document.archive",
  "document.manage.types",
  "document.manage.categories",
  "document.manage.allocations",

  // Messaging
  "messaging.conversation.create",
  "messaging.message.send",
  "messaging.message.edit.own",
  "messaging.message.delete.own",
  "messaging.group.manage",
  "messaging.attachment.upload",
  "messaging.attachment.download",

  // Reports
  "reports.view.self",
  "reports.view.team",
  "reports.view.department",
  "reports.view.organization",
  "reports.export",

  // Administration
  "admin.users.manage",
  "admin.departments.manage",
  "admin.divisions.manage",
  "admin.permissions.manage",
  "admin.settings.manage",
  "system.admin.overview",
] as const;

export type PermissionIdentifier = typeof MASTER_PERMISSION_CATALOGUE[number] | string;

// ---------------------------------------------------------------------------
// 2. Default Predefined Role Permissions
// ---------------------------------------------------------------------------

export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [
    ...MASTER_PERMISSION_CATALOGUE,
  ],
  ADMIN: [
    "employee.view.organization",
    "employee.create",
    "employee.update.assigned",
    "employee.archive",
    "attendance.view.organization",
    "attendance.manage",
    "attendance.correct",
    "attendance.export",
    "leave.view.team",
    "leave.approve.department",
    "leave.manage",
    "payroll.view.organization",
    "payroll.create",
    "payroll.manage",
    "payroll.export",
    "crm.view.department",
    "crm.create",
    "crm.assign",
    "project.view.department",
    "project.create",
    "project.update",
    "project.assign",
    "project.archive",
    "document.view.organization",
    "document.create",
    "document.update.assigned",
    "document.upload",
    "document.download",
    "document.archive",
    "document.manage.types",
    "document.manage.categories",
    "messaging.conversation.create",
    "messaging.message.send",
    "messaging.message.edit.own",
    "messaging.message.delete.own",
    "messaging.group.manage",
    "messaging.attachment.upload",
    "messaging.attachment.download",
    "reports.view.organization",
    "reports.export",
    "admin.users.manage",
    "admin.departments.manage",
    "admin.divisions.manage",
    "admin.permissions.manage",
  ],
  DIVISION_ADMIN: [
    "employee.view.department",
    "attendance.view.department",
    "leave.view.team",
    "leave.approve.department",
    "project.view.department",
    "document.view.division",
    "document.create",
    "document.upload",
    "document.download",
    "messaging.conversation.create",
    "messaging.message.send",
    "messaging.message.edit.own",
    "messaging.message.delete.own",
    "messaging.group.manage",
    "messaging.attachment.upload",
    "messaging.attachment.download",
    "reports.view.department",
  ],
  MANAGER: [
    "employee.view.department",
    "attendance.view.team",
    "leave.view.team",
    "leave.approve.team",
    "project.view.assigned",
    "project.update",
    "document.view.department",
    "document.create",
    "document.upload",
    "document.download",
    "messaging.conversation.create",
    "messaging.message.send",
    "messaging.message.edit.own",
    "messaging.message.delete.own",
    "messaging.group.manage",
    "messaging.attachment.upload",
    "messaging.attachment.download",
    "reports.view.team",
  ],
  TEAM_LEADER: [
    "attendance.view.team",
    "leave.view.team",
    "leave.approve.team",
    "project.view.assigned",
    "document.view.department",
    "document.upload",
    "document.download",
    "messaging.conversation.create",
    "messaging.message.send",
    "messaging.message.edit.own",
    "messaging.message.delete.own",
    "messaging.attachment.upload",
    "messaging.attachment.download",
    "reports.view.team",
  ],
  EMPLOYEE: [
    "employee.view.self",
    "attendance.view.self",
    "leave.apply.self",
    "leave.view.self",
    "project.view.assigned",
    "document.view",
    "document.view.own",
    "document.view.shared",
    "document.download",
    "messaging.conversation.create",
    "messaging.message.send",
    "messaging.message.edit.own",
    "messaging.message.delete.own",
    "messaging.attachment.upload",
    "messaging.attachment.download",
    "reports.view.self",
  ],
  INTERN: [
    "employee.view.self",
    "attendance.view.self",
    "leave.apply.self",
    "leave.view.self",
    "project.view.assigned",
    "document.view.own",
    "document.download",
    "messaging.conversation.create",
    "messaging.message.send",
    "messaging.message.edit.own",
    "messaging.message.delete.own",
    "messaging.attachment.upload",
    "messaging.attachment.download",
    "reports.view.self",
  ],
};

// ---------------------------------------------------------------------------
// 3. Predefined Department Permission Profiles (Section 5.3)
// ---------------------------------------------------------------------------

export const PREDEFINED_DEPARTMENT_PROFILES: Array<{
  code: string;
  name: string;
  departmentCode: string;
  targetRole: string;
  permissions: string[];
}> = [
  // HR
  {
    code: "HR_HEAD",
    name: "HR Head",
    departmentCode: "HR",
    targetRole: "MANAGER",
    permissions: [
      "employee.view.organization",
      "employee.create",
      "employee.update.assigned",
      "attendance.view.organization",
      "attendance.manage",
      "attendance.correct",
      "leave.approve.department",
      "payroll.view.organization",
      "document.view.organization",
      "document.create",
      "document.archive",
      "reports.view.organization",
    ],
  },
  {
    code: "HR_MANAGER",
    name: "HR Manager",
    departmentCode: "HR",
    targetRole: "MANAGER",
    permissions: [
      "employee.view.organization",
      "employee.update.assigned",
      "attendance.view.organization",
      "attendance.manage",
      "leave.approve.team",
      "document.view.organization",
      "document.create",
      "reports.view.department",
    ],
  },
  {
    code: "HR_EXECUTIVE",
    name: "HR Executive",
    departmentCode: "HR",
    targetRole: "EMPLOYEE",
    permissions: [
      "employee.view.organization",
      "attendance.view.organization",
      "document.view.department",
      "document.create",
      "document.upload",
      "reports.view.department",
    ],
  },
  {
    code: "HR_RECRUITER",
    name: "HR Recruiter",
    departmentCode: "HR",
    targetRole: "EMPLOYEE",
    permissions: [
      "employee.view.self",
      "document.view.department",
      "document.create",
      "document.upload",
    ],
  },

  // Finance & Accounts
  {
    code: "FINANCE_HEAD",
    name: "Finance Head",
    departmentCode: "FINANCE",
    targetRole: "MANAGER",
    permissions: [
      "payroll.view.organization",
      "payroll.create",
      "payroll.manage",
      "payroll.export",
      "document.view.organization",
      "document.create",
      "document.archive",
      "reports.view.organization",
    ],
  },
  {
    code: "ACCOUNTANT",
    name: "Accountant",
    departmentCode: "FIN",
    targetRole: "EMPLOYEE",
    permissions: [
      "payroll.view.department",
      "payroll.view.organization",
      "payroll.manage",
      "payroll.create",
      "document.view.department",
      "document.create",
      "document.upload",
      "reports.view.department",
    ],
  },
  {
    code: "FINANCE_EXECUTIVE",
    name: "Finance Executive",
    departmentCode: "FIN",
    targetRole: "EMPLOYEE",
    permissions: [
      "payroll.view.department",
      "payroll.view.organization",
      "payroll.manage",
      "document.view.department",
      "document.create",
      "document.upload",
    ],
  },

  // Sales
  {
    code: "SALES_HEAD",
    name: "Sales Head",
    departmentCode: "SALES",
    targetRole: "MANAGER",
    permissions: [
      "crm.view.department",
      "crm.create",
      "crm.update.assigned",
      "crm.assign",
      "crm.export",
      "document.view.department",
      "document.create",
      "reports.view.department",
    ],
  },
  {
    code: "SALES_MANAGER",
    name: "Sales Manager",
    departmentCode: "SALES",
    targetRole: "MANAGER",
    permissions: [
      "crm.view.team",
      "crm.create",
      "crm.update.assigned",
      "crm.assign",
      "document.view.department",
      "document.create",
      "reports.view.team",
    ],
  },
  {
    code: "SALES_EXECUTIVE",
    name: "Sales Executive",
    departmentCode: "SALES",
    targetRole: "EMPLOYEE",
    permissions: [
      "crm.view.assigned",
      "crm.create",
      "crm.update.assigned",
      "document.view.department",
      "document.create",
      "document.upload",
    ],
  },

  // Software Development
  {
    code: "DEVELOPMENT_HEAD",
    name: "Development Head",
    departmentCode: "DEV_CORE",
    targetRole: "MANAGER",
    permissions: [
      "project.view.department",
      "project.create",
      "project.update",
      "project.assign",
      "task.view.team",
      "task.manage",
      "document.view.department",
      "document.create",
      "reports.view.department",
    ],
  },
  {
    code: "TECH_LEAD",
    name: "Tech Lead",
    departmentCode: "DEV_CORE",
    targetRole: "TEAM_LEADER",
    permissions: [
      "project.view.assigned",
      "project.update",
      "task.view.team",
      "task.manage",
      "document.view.department",
      "document.upload",
      "document.download",
      "reports.view.team",
    ],
  },
  {
    code: "BACKEND_DEVELOPER",
    name: "Backend Developer",
    departmentCode: "DEV_BACKEND",
    targetRole: "EMPLOYEE",
    permissions: [
      "project.view.assigned",
      "task.view.team",
      "document.view.department",
      "document.download",
      "messaging.message.send",
    ],
  },
  {
    code: "SOFTWARE_ENGINEER",
    name: "Software Engineer",
    departmentCode: "ENG",
    targetRole: "EMPLOYEE",
    permissions: [
      "project.view.assigned",
      "project.view.department",
      "task.view.team",
      "document.view.department",
      "document.download",
      "messaging.message.send",
    ],
  },
  {
    code: "FRONTEND_DEVELOPER",
    name: "Frontend Developer",
    departmentCode: "DEV_FRONTEND",
    targetRole: "EMPLOYEE",
    permissions: [
      "project.view.assigned",
      "task.view.team",
      "document.view.department",
      "document.download",
      "messaging.message.send",
    ],
  },
  {
    code: "QA_ENGINEER",
    name: "QA Engineer",
    departmentCode: "QA",
    targetRole: "EMPLOYEE",
    permissions: [
      "project.view.assigned",
      "task.view.team",
      "document.view.department",
      "document.download",
    ],
  },
  {
    code: "UI_UX_DESIGNER",
    name: "UI/UX Designer",
    departmentCode: "UI_UX",
    targetRole: "EMPLOYEE",
    permissions: [
      "project.view.assigned",
      "task.view.team",
      "document.view.department",
      "document.upload",
      "document.download",
    ],
  },

  // Operations
  {
    code: "OPERATIONS_HEAD",
    name: "Operations Head",
    departmentCode: "OPERATIONS",
    targetRole: "MANAGER",
    permissions: [
      "document.view.organization",
      "document.create",
      "document.archive",
      "reports.view.department",
    ],
  },
];

/**
 * Ensure all predefined permission profiles are initialized.
 */
export async function ensurePredefinedPermissionProfiles(): Promise<void> {
  for (const prof of PREDEFINED_DEPARTMENT_PROFILES) {
    await PermissionProfile.findOneAndUpdate(
      { code: prof.code, organizationId: null },
      {
        $setOnInsert: {
          code: prof.code,
          name: prof.name,
          departmentCode: prof.departmentCode,
          targetRole: prof.targetRole,
          permissions: prof.permissions,
          isPredefined: true,
          isSystemPredefined: true,
          status: "ACTIVE",
        },
      },
      { upsert: true, new: true }
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Deterministic Permission Resolution Engine (Section 5.5)
// ---------------------------------------------------------------------------

/**
 * Resolve the complete effective permissions for a user:
 * Precedence:
 * 1. Role Default Permissions
 * 2. Department Permission Profile (if linked)
 * 3. Designation Profile (if linked)
 * 4. Plus User Explicit Granted Permissions (overrides)
 * 5. Minus User Explicit Denied Permissions (EXPLICIT DENIAL ALWAYS WINS!)
 */
export async function resolveEffectivePermissions(user: any): Promise<string[]> {
  if (!user) return [];

  // Always refresh latest user profile and overrides if user has _id
  let targetUser = user;
  if (user._id) {
    const fresh = await User.findById(user._id).lean();
    if (fresh) targetUser = fresh;
  }

  // SUPER_ADMIN has platform-wide authority unless explicitly denied
  const granted = new Set<string>();

  // 1. Role defaults
  const roleDefaults = ROLE_DEFAULT_PERMISSIONS[targetUser.role] || [];
  for (const p of roleDefaults) {
    granted.add(p);
  }

  // 2. Department Profile permissions
  if (targetUser.departmentProfileId) {
    const deptProfile = await PermissionProfile.findById(targetUser.departmentProfileId).lean();
    if (deptProfile && deptProfile.status === "ACTIVE") {
      for (const p of deptProfile.permissions || []) {
        granted.add(p);
      }
    }
  }

  // 3. Designation Profile permissions
  if (targetUser.designationProfileId) {
    const desigProfile = await PermissionProfile.findById(targetUser.designationProfileId).lean();
    if (desigProfile && desigProfile.status === "ACTIVE") {
      for (const p of desigProfile.permissions || []) {
        granted.add(p);
      }
    }
  }

  // 4. User explicit granted overrides
  const userGranted = targetUser.grantedPermissions || targetUser.permissions || [];
  if (Array.isArray(userGranted)) {
    for (const p of userGranted) {
      granted.add(p);
    }
  }

  // 5. User explicit denied permissions (EXPLICIT DENIAL OVERRIDES ALL)
  const deniedList = targetUser.deniedPermissions || [];
  const denied = new Set<string>(Array.isArray(deniedList) ? deniedList : []);

  const effective = Array.from(granted).filter((p) => !denied.has(p));
  return effective.sort();
}

export async function setUserPermissionOverrides(
  currentUser: any,
  targetUserId: string,
  grantedPermissions: string[],
  deniedPermissions: string[]
): Promise<any> {
  if (currentUser.role !== "SUPER_ADMIN" && currentUser.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Only administrators can configure user permission overrides.");
  }
  return await User.findByIdAndUpdate(
    targetUserId,
    {
      $set: {
        permissions: grantedPermissions,
        grantedPermissions,
        deniedPermissions,
      },
    },
    { new: true }
  );
}

/**
 * Core check: Does the user have the specified permission?
 */
export async function hasPermission(
  user: any,
  permission: string,
  context?: {
    organizationId?: string | Types.ObjectId;
    divisionId?: string | Types.ObjectId;
    departmentId?: string;
    teamId?: string;
    resourceOwnerId?: string | Types.ObjectId;
  }
): Promise<boolean> {
  if (!user) return false;

  // 1. Organization tenant boundary check
  if (context?.organizationId && user.role !== "SUPER_ADMIN") {
    if (String(user.organizationId) !== String(context.organizationId)) {
      return false; // Cross-tenant access blocked
    }
  }

  // 2. Check effective permissions
  const permissions = await resolveEffectivePermissions(user);
  if (!permissions.includes(permission)) {
    return false;
  }

  // 3. Scoping check if context provided
  if (context?.divisionId && user.role === "DIVISION_ADMIN") {
    if (!user.divisionId || String(user.divisionId) !== String(context.divisionId)) {
      return false;
    }
  }

  return true;
}

export async function hasAnyPermission(user: any, permissions: string[]): Promise<boolean> {
  const effective = await resolveEffectivePermissions(user);
  return permissions.some((p) => effective.includes(p));
}

export async function hasAllPermissions(user: any, permissions: string[]): Promise<boolean> {
  const effective = await resolveEffectivePermissions(user);
  return permissions.every((p) => effective.includes(p));
}

// ---------------------------------------------------------------------------
// 5. Automatic Profile Assignment on Onboarding & Transfer Recalculation (Section 5.6)
// ---------------------------------------------------------------------------

/**
 * Automatically resolve and assign the appropriate department permission profile
 * when an employee or intern is created or transferred.
 */
export async function assignDefaultDepartmentProfile(
  user: any,
  departmentCodeOrName?: string
): Promise<void> {
  if (!departmentCodeOrName || !user._id) return;

  await ensurePredefinedPermissionProfiles();

  const codeUpper = departmentCodeOrName.toUpperCase().trim();

  // Find matching profile by department code or designation
  let matchedProfile = await PermissionProfile.findOne({
    departmentCode: codeUpper,
    targetRole: user.role,
    status: "ACTIVE",
  });

  if (!matchedProfile) {
    matchedProfile = await PermissionProfile.findOne({
      departmentCode: codeUpper,
      status: "ACTIVE",
    });
  }

  if (!matchedProfile) {
    // Fallback: match by designation
    if (user.designation) {
      const desigMatch = user.designation.toUpperCase().replace(/\s+/g, "_");
      matchedProfile = await PermissionProfile.findOne({
        code: desigMatch,
        status: "ACTIVE",
      });
    }
  }

  if (!matchedProfile) {
    matchedProfile = await PermissionProfile.findOne({
      $or: [
        { code: new RegExp(codeUpper, "i") },
        { name: new RegExp(codeUpper, "i") },
      ],
      status: "ACTIVE",
    });
  }

  if (matchedProfile) {
    await User.updateOne(
      { _id: user._id },
      { $set: { departmentProfileId: matchedProfile._id } }
    );
    user.departmentProfileId = matchedProfile._id;
  }
}

/**
 * Transactionally recalculate permissions when an employee transfers to another department or role.
 * Clears old department-specific profile permissions to avoid lingering unauthorized access.
 */
export async function handleDepartmentTransfer(
  user: any,
  newDepartmentId: string,
  newDepartmentCode?: string,
  newRole?: string
): Promise<void> {
  const updateData: any = {
    departmentId: newDepartmentId,
    departmentProfileId: null, // Clear old department profile
  };

  if (newRole) {
    updateData.role = newRole;
  }

  await User.updateOne({ _id: user._id }, { $set: updateData });

  // Re-assign appropriate new profile
  if (newDepartmentCode) {
    const updatedUser = await User.findById(user._id);
    await assignDefaultDepartmentProfile(updatedUser, newDepartmentCode);
  }
}
