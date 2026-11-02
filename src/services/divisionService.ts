import mongoose from "mongoose";
import Division, { IDivision, DivisionStatus } from "../models/Division";
import Department from "../models/Department";
import Team from "../models/Team";
import User from "../models/User";
import Project from "../models/Project";
import Task from "../models/Task";
import {
  isReservedDivisionIdentity,
  isValidDivisionCode,
} from "../constants/division";
import {
  DivisionCreateInput,
  DivisionUpdateInput,
} from "../validators/division";
import {
  hasDivisionAccess,
  validateDivisionScope,
} from "../utils/divisionAuth";
import { recordAuditLog } from "./auditLogService";

function toIdString(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") return val.trim();
  if (val instanceof mongoose.Types.ObjectId) return val.toString();
  if (val._id) return toIdString(val._id);
  return String(val).trim();
}

/**
 * Validates division head assignment.
 *
 * Verifies that the designated division head:
 * 1. Exists in MongoDB.
 * 2. Belongs to the same organization (rejects cross-tenant assignment).
 * 3. Is an active employee (not inactive, suspended, resigned, terminated).
 */
export async function validateDivisionHead(
  organizationId: string | mongoose.Types.ObjectId,
  divisionHeadId: string | mongoose.Types.ObjectId,
  divisionId?: string | mongoose.Types.ObjectId
): Promise<boolean> {
  if (!divisionHeadId) return true;

  const orgIdStr = toIdString(organizationId);
  const headIdStr = toIdString(divisionHeadId);

  const headUser = await User.findById(headIdStr).select("organizationId status employmentStatus fullName").lean();
  if (!headUser) {
    throw new Error("USER_NOT_FOUND: Designated division head user does not exist.");
  }

  const userOrgIdStr = toIdString(headUser.organizationId);
  if (userOrgIdStr !== orgIdStr) {
    throw new Error("CROSS_TENANT_REFERENCE: Division head must belong to the parent organization.");
  }

  const currentStatus = headUser.status || headUser.employmentStatus || "ACTIVE";
  if (["INACTIVE", "SUSPENDED", "RESIGNED", "TERMINATED", "EXITED"].includes(currentStatus)) {
    throw new Error("INACTIVE_USER: Division head must be an active employee.");
  }

  return true;
}

/**
 * Checks organization-scoped division name uniqueness.
 */
export async function checkDivisionNameUnique(
  organizationId: string | mongoose.Types.ObjectId,
  name: string,
  excludeDivisionId?: string | mongoose.Types.ObjectId
): Promise<boolean> {
  const orgIdStr = toIdString(organizationId);
  const trimmedName = name.trim();

  const query: any = {
    organizationId: orgIdStr,
    name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
  };

  if (excludeDivisionId) {
    query._id = { $ne: excludeDivisionId };
  }

  const existing = await Division.findOne(query).select("_id").lean();
  if (existing) {
    throw new Error("DIVISION_NAME_EXISTS: A division with this name already exists in this organization.");
  }

  return true;
}

/**
 * Checks organization-scoped division code uniqueness.
 */
export async function checkDivisionCodeUnique(
  organizationId: string | mongoose.Types.ObjectId,
  code: string,
  excludeDivisionId?: string | mongoose.Types.ObjectId
): Promise<boolean> {
  const orgIdStr = toIdString(organizationId);
  const trimmedCode = code.trim().toUpperCase();

  const query: any = {
    organizationId: orgIdStr,
    code: trimmedCode,
  };

  if (excludeDivisionId) {
    query._id = { $ne: excludeDivisionId };
  }

  const existing = await Division.findOne(query).select("_id").lean();
  if (existing) {
    throw new Error("DIVISION_CODE_EXISTS: A division with this code already exists in this organization.");
  }

  return true;
}

/**
 * Counts active dependent records associated with a division.
 */
export async function getDivisionDependentCounts(divisionId: string | mongoose.Types.ObjectId) {
  const divId = toIdString(divisionId);
  const [activeDepartments, activeTeams, activeUsers, activeProjects, activeTasks] =
    await Promise.all([
      Department.countDocuments({ divisionId: divId, status: "ACTIVE" }),
      Team.countDocuments({ divisionId: divId, status: "ACTIVE" }),
      User.countDocuments({
        divisionId: divId,
        status: { $nin: ["EXITED", "TERMINATED", "RESIGNED", "INACTIVE"] },
        employmentStatus: { $nin: ["EXITED", "TERMINATED", "RESIGNED"] },
      }),
      Project.countDocuments({ divisionId: divId, status: { $in: ["PLANNED", "ACTIVE", "ON_HOLD"] } }),
      Task.countDocuments({ divisionId: divId, status: { $nin: ["COMPLETED", "CANCELLED"] } }),
    ]);

  const total = activeDepartments + activeTeams + activeUsers + activeProjects + activeTasks;

  return {
    activeDepartments,
    activeTeams,
    activeUsers,
    activeProjects,
    activeTasks,
    total,
  };
}

/**
 * Creates a new division.
 *
 * Rules:
 * - Server-side identity determines organization scope. Never trust client-supplied organization IDs.
 * - Reserved identity "NX Media" variants are strictly prohibited at service layer.
 * - Division code must match ^[A-Z0-9]{2,6}$.
 * - Name and code must be unique within the organization.
 * - Division head must be an active employee in the same organization.
 */
export async function createDivision(actor: any, input: DivisionCreateInput) {
  if (!actor) {
    throw new Error("UNAUTHORIZED: Authentication required to create a division.");
  }

  const actorRole = actor.role || "EMPLOYEE";
  if (actorRole !== "SUPER_ADMIN" && actorRole !== "ADMIN") {
    throw new Error("FORBIDDEN: Insufficient permissions to create a division.");
  }

  // Derive organization scope from authenticated server-side identity
  let targetOrgId: string;
  if (actorRole === "SUPER_ADMIN") {
    targetOrgId = input.organizationId || toIdString(actor.organizationId) || "";
    if (!targetOrgId) {
      throw new Error("ORGANIZATION_REQUIRED: Super Admin must specify an organization ID.");
    }
  } else {
    targetOrgId = toIdString(actor.organizationId) || "";
    if (!targetOrgId) {
      throw new Error("ORGANIZATION_REQUIRED: Admin has no authenticated organization assignment.");
    }
  }

  // 1. Reserved entity identity restriction ("NX Media")
  if (isReservedDivisionIdentity(input.name)) {
    throw new Error(
      "RESERVED_DIVISION_NAME_PROHIBITED: The entity 'NX Media' is a reserved corporate entity and cannot be created as an internal division."
    );
  }

  // 2. Division code format validation
  if (!input.code || !isValidDivisionCode(input.code.trim())) {
    throw new Error("INVALID_DIVISION_CODE: Division code must contain 2-6 uppercase alphanumeric characters.");
  }
  const cleanCode = input.code.trim().toUpperCase();

  // 3. Organization-scoped name & code uniqueness
  await checkDivisionNameUnique(targetOrgId, input.name);
  await checkDivisionCodeUnique(targetOrgId, cleanCode);

  // 4. Division head assignment validation
  if (input.divisionHeadId) {
    await validateDivisionHead(targetOrgId, input.divisionHeadId);
  }

  // 5. Create Division
  const division = await Division.create({
    organizationId: new mongoose.Types.ObjectId(targetOrgId),
    name: input.name.trim(),
    code: cleanCode,
    description: input.description ?? null,
    divisionHeadId: input.divisionHeadId ? new mongoose.Types.ObjectId(input.divisionHeadId) : null,
    budgetCode: input.budgetCode ?? null,
    status: input.status || "ACTIVE",
  });

  await recordAuditLog({
    organizationId: targetOrgId,
    actorId: toIdString(actor._id) || "SYSTEM",
    actorRole: actor.role || "UNKNOWN",
    action: "DIVISION_CREATED",
    entityType: "DIVISION",
    entityId: toIdString(division._id) || "",
    summary: `Created division ${division.name} (${division.code})`,
    metadata: {
      code: division.code,
      divisionHeadId: division.divisionHeadId,
      budgetCode: division.budgetCode,
    },
  });

  return division.toObject();
}

/**
 * Retrieves a division by ID with authorization check.
 */
export async function getDivisionById(actor: any, divisionId: string | mongoose.Types.ObjectId) {
  const divIdStr = toIdString(divisionId);
  if (!divIdStr) return null;

  const division = await Division.findById(divIdStr).lean();
  if (!division) return null;

  const hasAccess = await hasDivisionAccess(actor, division);
  if (!hasAccess) {
    throw new Error("FORBIDDEN: Access to division denied.");
  }

  return division;
}

/**
 * Lists divisions accessible to the authenticated actor.
 */
export async function listDivisions(
  actor: any,
  query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    includeInactive?: boolean;
    organizationId?: string;
  } = {}
) {
  if (!actor) {
    throw new Error("UNAUTHORIZED: Authentication required to list divisions.");
  }

  const { page = 1, limit = 50, search, status, includeInactive = false } = query;
  const skip = (page - 1) * limit;
  const actorRole = actor.role || "EMPLOYEE";
  const actorOrgId = toIdString(actor.organizationId);

  const filter: any = {};

  if (actorRole === "SUPER_ADMIN") {
    if (query.organizationId) {
      filter.organizationId = query.organizationId;
    }
  } else if (actorRole === "ADMIN") {
    filter.organizationId = actorOrgId;
  } else if (actorRole === "DIVISION_ADMIN") {
    const actorDivId = toIdString(actor.divisionId || actor.primaryDivisionId);
    if (!actorDivId) {
      throw new Error("FORBIDDEN: Division administrator has no assigned division.");
    }
    filter.organizationId = actorOrgId;
    filter._id = actorDivId;
  } else {
    // Other roles: only assigned division if any
    const userDivId = toIdString(actor.divisionId || actor.primaryDivisionId);
    if (!userDivId) {
      return { items: [], total: 0, page, limit };
    }
    filter.organizationId = actorOrgId;
    filter._id = userDivId;
  }

  if (status) {
    filter.status = status;
  } else if (!includeInactive) {
    filter.status = "ACTIVE";
  }

  if (search) {
    const s = new RegExp(search.trim(), "i");
    filter.$or = [{ name: s }, { code: s }, { description: s }];
  }

  const [items, total] = await Promise.all([
    Division.find(filter)
      .populate("divisionHeadId", "_id fullName email employeeId designation")
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Division.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

/**
 * Updates permitted division fields.
 *
 * Rules:
 * - organizationId and code are strictly IMMUTABLE.
 * - Reserved identity "NX Media" variants are rejected for name changes.
 * - Division head must be an active employee in same organization.
 * - Direct transition to ARCHIVED is guarded by archival checks.
 */
export async function updateDivision(
  actor: any,
  divisionId: string | mongoose.Types.ObjectId,
  input: DivisionUpdateInput
) {
  if (!actor) {
    throw new Error("UNAUTHORIZED: Authentication required to update division.");
  }

  const divIdStr = toIdString(divisionId);
  const division = await Division.findById(divIdStr);
  if (!division) {
    throw new Error("DIVISION_NOT_FOUND: Division does not exist.");
  }

  // Authorization check
  const actorRole = actor.role || "EMPLOYEE";
  const actorOrgId = toIdString(actor.organizationId);
  if (actorRole !== "SUPER_ADMIN") {
    if (actorRole !== "ADMIN" || toIdString(division.organizationId) !== actorOrgId) {
      throw new Error("FORBIDDEN: Insufficient permissions to update this division.");
    }
  }

  // Reserved identity check on name update
  if (input.name) {
    if (isReservedDivisionIdentity(input.name)) {
      throw new Error(
        "RESERVED_DIVISION_NAME_PROHIBITED: The entity 'NX Media' is a reserved corporate entity and cannot be used as a division name."
      );
    }
    if (input.name.trim() !== division.name) {
      await checkDivisionNameUnique(division.organizationId, input.name, division._id);
      division.name = input.name.trim();
    }
  }

  // Division head validation on update
  if (input.divisionHeadId !== undefined) {
    if (input.divisionHeadId) {
      await validateDivisionHead(division.organizationId, input.divisionHeadId, division._id);
      division.divisionHeadId = new mongoose.Types.ObjectId(input.divisionHeadId);
    } else {
      division.divisionHeadId = null;
    }
  }

  if (input.description !== undefined) {
    division.description = input.description;
  }

  if (input.budgetCode !== undefined) {
    division.budgetCode = input.budgetCode;
  }

  if (input.status) {
    if (input.status === "ARCHIVED" && division.status !== "ARCHIVED") {
      // Must follow archival workflow verification
      const dependents = await getDivisionDependentCounts(division._id);
      if (dependents.total > 0) {
        throw new Error(
          `ARCHIVAL_BLOCKED_DEPENDENTS_EXIST: Division cannot be archived with ${dependents.total} active dependent records. Reassignment or an approved archival workflow is required.`
        );
      }
    }
    division.status = input.status;
  }

  await division.save();

  await recordAuditLog({
    organizationId: toIdString(division.organizationId) || "",
    actorId: toIdString(actor._id) || "SYSTEM",
    actorRole: actor.role || "UNKNOWN",
    action: "DIVISION_UPDATED",
    entityType: "DIVISION",
    entityId: divIdStr || "",
    summary: `Updated division ${division.name} (${division.code})`,
    metadata: {
      name: division.name,
      divisionHeadId: division.divisionHeadId,
      status: division.status,
    },
  });

  return division.toObject();
}

/**
 * Archives a division.
 *
 * Rules:
 * - Prevents archival when active dependent records (departments, teams, users, projects, tasks)
 *   require reassignment, UNLESS an approved archival workflow is explicitly signaled.
 * - Never automatically reassigns or modifies existing records.
 */
export async function archiveDivision(
  actor: any,
  divisionId: string | mongoose.Types.ObjectId,
  options?: { approvedWorkflow?: boolean }
) {
  if (!actor) {
    throw new Error("UNAUTHORIZED: Authentication required to archive division.");
  }

  const divIdStr = toIdString(divisionId);
  const division = await Division.findById(divIdStr);
  if (!division) {
    throw new Error("DIVISION_NOT_FOUND: Division does not exist.");
  }

  const actorRole = actor.role || "EMPLOYEE";
  const actorOrgId = toIdString(actor.organizationId);
  if (actorRole !== "SUPER_ADMIN") {
    if (actorRole !== "ADMIN" || toIdString(division.organizationId) !== actorOrgId) {
      throw new Error("FORBIDDEN: Insufficient permissions to archive this division.");
    }
  }

  // Check dependent records
  const dependents = await getDivisionDependentCounts(division._id);

  if (dependents.total > 0 && !options?.approvedWorkflow) {
    throw new Error(
      `ARCHIVAL_BLOCKED_DEPENDENTS_EXIST: Division cannot be archived while dependent active records exist (Departments: ${dependents.activeDepartments}, Teams: ${dependents.activeTeams}, Users: ${dependents.activeUsers}, Projects: ${dependents.activeProjects}, Tasks: ${dependents.activeTasks}). Reassign dependent records or supply an approved archival workflow.`
    );
  }

  // Do not automatically reassign or modify existing records
  division.status = "ARCHIVED";
  await division.save();

  await recordAuditLog({
    organizationId: toIdString(division.organizationId) || "",
    actorId: toIdString(actor._id) || "SYSTEM",
    actorRole: actor.role || "UNKNOWN",
    action: "DIVISION_ARCHIVED",
    entityType: "DIVISION",
    entityId: divIdStr || "",
    summary: `Archived division ${division.name} (${division.code})`,
    metadata: {
      dependentsAtArchival: dependents,
      approvedWorkflow: Boolean(options?.approvedWorkflow),
    },
  });

  return division.toObject();
}

/**
 * Deactivates a division (status -> INACTIVE).
 */
export async function deactivateDivision(actor: any, divisionId: string | mongoose.Types.ObjectId) {
  if (!actor) {
    throw new Error("UNAUTHORIZED: Authentication required to deactivate division.");
  }

  const divIdStr = toIdString(divisionId);
  const division = await Division.findById(divIdStr);
  if (!division) {
    throw new Error("DIVISION_NOT_FOUND: Division does not exist.");
  }

  const actorRole = actor.role || "EMPLOYEE";
  const actorOrgId = toIdString(actor.organizationId);
  if (actorRole !== "SUPER_ADMIN") {
    if (actorRole !== "ADMIN" || toIdString(division.organizationId) !== actorOrgId) {
      throw new Error("FORBIDDEN: Insufficient permissions to deactivate this division.");
    }
  }

  division.status = "INACTIVE";
  await division.save();

  await recordAuditLog({
    organizationId: toIdString(division.organizationId) || "",
    actorId: toIdString(actor._id) || "SYSTEM",
    actorRole: actor.role || "UNKNOWN",
    action: "DIVISION_DEACTIVATED",
    entityType: "DIVISION",
    entityId: divIdStr || "",
    summary: `Deactivated division ${division.name} (${division.code})`,
  });

  return division.toObject();
}
