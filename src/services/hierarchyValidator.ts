import mongoose from "mongoose";
import Organization from "../models/Organization";
import Division from "../models/Division";
import Department from "../models/Department";
import Team from "../models/Team";
import User from "../models/User";
import Project from "../models/Project";
import Task from "../models/Task";

/**
 * HierarchyValidationError: Structured error class for hierarchy validation failures.
 */
export class HierarchyValidationError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(`${code}: ${message}`);
    this.name = "HierarchyValidationError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Helper to safely convert an identifier to string or null.
 */
function toIdString(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") return val.trim();
  if (val instanceof mongoose.Types.ObjectId) return val.toString();
  if (val._id) return toIdString(val._id);
  return String(val).trim();
}

/**
 * Helper to check whether an ID string is a valid MongoDB ObjectId.
 */
function isValidObjectIdString(val: any): boolean {
  if (!val) return false;
  return mongoose.Types.ObjectId.isValid(String(val));
}

/**
 * 1. Validate Organization → Division relationship
 *
 * Verifies that the division exists, belongs to the specified organization,
 * and that parents are active where required. Rejects cross-tenant references.
 */
export async function validateOrganizationDivision(params: {
  organizationId: string | mongoose.Types.ObjectId;
  divisionId: string | mongoose.Types.ObjectId;
  requireActive?: boolean;
}) {
  const orgIdStr = toIdString(params.organizationId);
  const divIdStr = toIdString(params.divisionId);
  const requireActive = params.requireActive ?? true;

  if (!orgIdStr) {
    throw new HierarchyValidationError("ORGANIZATION_REQUIRED", "Organization ID is required.");
  }
  if (!divIdStr) {
    throw new HierarchyValidationError("DIVISION_REQUIRED", "Division ID is required.");
  }

  const organization = await Organization.findById(orgIdStr).lean();
  if (!organization) {
    throw new HierarchyValidationError("ORGANIZATION_NOT_FOUND", `Organization ${orgIdStr} not found.`);
  }

  if (requireActive && organization.status !== "ACTIVE") {
    throw new HierarchyValidationError(
      "INACTIVE_PARENT_ORGANIZATION",
      `Organization ${orgIdStr} is inactive (status: ${organization.status}).`
    );
  }

  const division = await Division.findById(divIdStr).lean();
  if (!division) {
    throw new HierarchyValidationError("DIVISION_NOT_FOUND", `Division ${divIdStr} not found.`);
  }

  const divOrgIdStr = toIdString(division.organizationId);
  if (divOrgIdStr !== orgIdStr) {
    throw new HierarchyValidationError(
      "CROSS_TENANT_REFERENCE",
      `Division ${divIdStr} belongs to organization ${divOrgIdStr}, not ${orgIdStr}.`
    );
  }

  if (requireActive && division.status !== "ACTIVE") {
    throw new HierarchyValidationError(
      "INACTIVE_DIVISION",
      `Division ${divIdStr} is not active (status: ${division.status}).`
    );
  }

  return { organization, division };
}

/**
 * 2. Validate Organization → Department → Team relationship
 *
 * Verifies that Department belongs to Organization, and Team belongs to both
 * Department and Organization. Rejects cross-tenant and mismatched hierarchies.
 */
export async function validateOrganizationDepartmentTeam(params: {
  organizationId: string | mongoose.Types.ObjectId;
  departmentId: string | mongoose.Types.ObjectId;
  teamId?: string | mongoose.Types.ObjectId | null;
  requireActive?: boolean;
}) {
  const orgIdStr = toIdString(params.organizationId);
  const deptIdStr = toIdString(params.departmentId);
  const teamIdStr = toIdString(params.teamId);
  const requireActive = params.requireActive ?? true;

  if (!orgIdStr) {
    throw new HierarchyValidationError("ORGANIZATION_REQUIRED", "Organization ID is required.");
  }
  if (!deptIdStr) {
    throw new HierarchyValidationError("DEPARTMENT_REQUIRED", "Department ID is required.");
  }

  const organization = await Organization.findById(orgIdStr).lean();
  if (!organization) {
    throw new HierarchyValidationError("ORGANIZATION_NOT_FOUND", `Organization ${orgIdStr} not found.`);
  }

  if (requireActive && organization.status !== "ACTIVE") {
    throw new HierarchyValidationError(
      "INACTIVE_PARENT_ORGANIZATION",
      `Organization ${orgIdStr} is inactive.`
    );
  }

  const department = await Department.findById(deptIdStr).lean();
  if (!department) {
    throw new HierarchyValidationError("DEPARTMENT_NOT_FOUND", `Department ${deptIdStr} not found.`);
  }

  const deptOrgIdStr = toIdString(department.organizationId);
  if (deptOrgIdStr !== orgIdStr) {
    throw new HierarchyValidationError(
      "CROSS_TENANT_REFERENCE",
      `Department ${deptIdStr} belongs to organization ${deptOrgIdStr}, not ${orgIdStr}.`
    );
  }

  if (requireActive && department.status !== "ACTIVE") {
    throw new HierarchyValidationError(
      "INACTIVE_PARENT_DEPARTMENT",
      `Department ${deptIdStr} is inactive.`
    );
  }

  let team: any = null;
  if (teamIdStr) {
    team = await Team.findById(teamIdStr).lean();
    if (!team) {
      throw new HierarchyValidationError("TEAM_NOT_FOUND", `Team ${teamIdStr} not found.`);
    }

    const teamOrgIdStr = toIdString(team.organizationId);
    if (teamOrgIdStr !== orgIdStr) {
      throw new HierarchyValidationError(
        "CROSS_TENANT_REFERENCE",
        `Team ${teamIdStr} belongs to organization ${teamOrgIdStr}, not ${orgIdStr}.`
      );
    }

    const teamDeptIdStr = toIdString(team.departmentId);
    if (teamDeptIdStr !== deptIdStr) {
      throw new HierarchyValidationError(
        "HIERARCHY_MISMATCH",
        `Team ${teamIdStr} belongs to department ${teamDeptIdStr}, not ${deptIdStr}.`
      );
    }

    if (requireActive && team.status !== "ACTIVE") {
      throw new HierarchyValidationError("INACTIVE_TEAM", `Team ${teamIdStr} is inactive.`);
    }
  }

  return { organization, department, team };
}

/**
 * 3. Validate Division → Department → Team relationship
 *
 * Enforces divisional alignment:
 * - If Department is central (isCentral = true), it cannot have a divisionId.
 * - If Department has a divisionId, it must belong to that division.
 * - If Team has a divisionId, it must match the Department's divisionId.
 * - Missing or null divisionId never grants broader access or automatically
 *   classifies a record as a Headquarters record.
 */
export async function validateDivisionDepartmentTeam(params: {
  organizationId: string | mongoose.Types.ObjectId;
  departmentId: string | mongoose.Types.ObjectId;
  divisionId?: string | mongoose.Types.ObjectId | null;
  teamId?: string | mongoose.Types.ObjectId | null;
  requireActive?: boolean;
}) {
  const orgIdStr = toIdString(params.organizationId);
  const deptIdStr = toIdString(params.departmentId);
  const divIdStr = toIdString(params.divisionId);
  const teamIdStr = toIdString(params.teamId);
  const requireActive = params.requireActive ?? true;

  if (!orgIdStr) {
    throw new HierarchyValidationError("ORGANIZATION_REQUIRED", "Organization ID is required.");
  }
  if (!deptIdStr) {
    throw new HierarchyValidationError("DEPARTMENT_REQUIRED", "Department ID is required.");
  }

  const department = await Department.findById(deptIdStr).lean();
  if (!department) {
    throw new HierarchyValidationError("DEPARTMENT_NOT_FOUND", `Department ${deptIdStr} not found.`);
  }

  if (toIdString(department.organizationId) !== orgIdStr) {
    throw new HierarchyValidationError(
      "CROSS_TENANT_REFERENCE",
      "Department belongs to a different organization."
    );
  }

  if (requireActive && department.status !== "ACTIVE") {
    throw new HierarchyValidationError("INACTIVE_PARENT_DEPARTMENT", "Department is inactive.");
  }

  // Central Department Rules
  if (department.isCentral) {
    if (department.divisionId) {
      throw new HierarchyValidationError(
        "CENTRAL_DEPARTMENT_DIVISION_PROHIBITED",
        "A central headquarters department cannot be assigned to an operational division."
      );
    }
    if (divIdStr) {
      throw new HierarchyValidationError(
        "CENTRAL_DEPARTMENT_DIVISION_PROHIBITED",
        "Central headquarters department cannot be evaluated as an internal divisional department."
      );
    }
  }

  let division: any = null;
  if (divIdStr) {
    division = await Division.findById(divIdStr).lean();
    if (!division) {
      throw new HierarchyValidationError("DIVISION_NOT_FOUND", `Division ${divIdStr} not found.`);
    }
    if (toIdString(division.organizationId) !== orgIdStr) {
      throw new HierarchyValidationError(
        "CROSS_TENANT_REFERENCE",
        "Division belongs to a different organization."
      );
    }
    if (requireActive && division.status !== "ACTIVE") {
      throw new HierarchyValidationError("INACTIVE_DIVISION", "Division is not active.");
    }

    const deptDivIdStr = toIdString(department.divisionId);
    if (!deptDivIdStr) {
      // Missing or null divisionId must never grant broader access or classify as Headquarters
      throw new HierarchyValidationError(
        "UNCLASSIFIED_DEPARTMENT_DIVISION_MISMATCH",
        "Department has no division assignment and does not match the specified division."
      );
    }
    if (deptDivIdStr !== divIdStr) {
      throw new HierarchyValidationError(
        "DIVISION_MISMATCH",
        `Department belongs to division ${deptDivIdStr}, not ${divIdStr}.`
      );
    }
  }

  let team: any = null;
  if (teamIdStr) {
    team = await Team.findById(teamIdStr).lean();
    if (!team) {
      throw new HierarchyValidationError("TEAM_NOT_FOUND", `Team ${teamIdStr} not found.`);
    }
    if (toIdString(team.organizationId) !== orgIdStr) {
      throw new HierarchyValidationError("CROSS_TENANT_REFERENCE", "Team belongs to a different organization.");
    }
    if (toIdString(team.departmentId) !== deptIdStr) {
      throw new HierarchyValidationError("HIERARCHY_MISMATCH", "Team does not belong to the specified department.");
    }
    if (requireActive && team.status !== "ACTIVE") {
      throw new HierarchyValidationError("INACTIVE_TEAM", "Team is not active.");
    }

    const teamDivIdStr = toIdString(team.divisionId);
    const deptDivIdStr = toIdString(department.divisionId);

    // If Department is divisional, team's divisionId must match
    if (deptDivIdStr && teamDivIdStr && teamDivIdStr !== deptDivIdStr) {
      throw new HierarchyValidationError(
        "HIERARCHY_MISMATCH",
        `Team division (${teamDivIdStr}) does not match parent department division (${deptDivIdStr}).`
      );
    }

    if (divIdStr && teamDivIdStr && teamDivIdStr !== divIdStr) {
      throw new HierarchyValidationError(
        "DIVISION_MISMATCH",
        `Team belongs to division ${teamDivIdStr}, not ${divIdStr}.`
      );
    }
  }

  return { department, division, team };
}

/**
 * 4. Validate Organization/Division → User relationship
 *
 * Verifies persisted User relationships:
 * - User organization, division, department, team consistency.
 * - Preserves compatibility with legacy string-based User.departmentId and User.teamId.
 * - Rejects inactive parents where active parents are required.
 * - A missing or null divisionId must never grant broader access or automatically
 *   classify a record as a Headquarters record.
 */
export async function validateUserHierarchy(params: {
  organizationId: string | mongoose.Types.ObjectId;
  divisionId?: string | mongoose.Types.ObjectId | null;
  departmentId?: string | mongoose.Types.ObjectId | null;
  teamId?: string | mongoose.Types.ObjectId | null;
  userId?: string | mongoose.Types.ObjectId | null;
  requireActiveParents?: boolean;
}) {
  const orgIdStr = toIdString(params.organizationId);
  const divIdStr = toIdString(params.divisionId);
  const deptIdStr = params.departmentId ? String(params.departmentId).trim() : null;
  const teamIdStr = params.teamId ? String(params.teamId).trim() : null;
  const requireActive = params.requireActiveParents ?? true;

  if (!orgIdStr) {
    throw new HierarchyValidationError("ORGANIZATION_REQUIRED", "Organization ID is required.");
  }

  const organization = await Organization.findById(orgIdStr).lean();
  if (!organization) {
    throw new HierarchyValidationError("ORGANIZATION_NOT_FOUND", `Organization ${orgIdStr} not found.`);
  }
  if (requireActive && organization.status !== "ACTIVE") {
    throw new HierarchyValidationError(
      "INACTIVE_PARENT_ORGANIZATION",
      `Organization ${orgIdStr} is inactive.`
    );
  }

  let division: any = null;
  if (divIdStr) {
    division = await Division.findById(divIdStr).lean();
    if (!division) {
      throw new HierarchyValidationError("DIVISION_NOT_FOUND", `Division ${divIdStr} not found.`);
    }
    if (toIdString(division.organizationId) !== orgIdStr) {
      throw new HierarchyValidationError(
        "CROSS_TENANT_REFERENCE",
        `Division ${divIdStr} belongs to a different organization.`
      );
    }
    if (requireActive && division.status !== "ACTIVE") {
      throw new HierarchyValidationError(
        "INACTIVE_PARENT_DIVISION",
        `Division ${divIdStr} is not active (status: ${division.status}).`
      );
    }
  }

  let department: any = null;
  if (deptIdStr) {
    // Preserve compatibility with legacy string-based User.departmentId
    if (isValidObjectIdString(deptIdStr)) {
      department = await Department.findById(deptIdStr).lean();
      if (department) {
        if (toIdString(department.organizationId) !== orgIdStr) {
          throw new HierarchyValidationError(
            "CROSS_TENANT_REFERENCE",
            `User department belongs to organization ${toIdString(department.organizationId)}, not ${orgIdStr}.`
          );
        }
        if (requireActive && department.status !== "ACTIVE") {
          throw new HierarchyValidationError(
            "INACTIVE_PARENT_DEPARTMENT",
            `Parent department ${deptIdStr} is inactive.`
          );
        }

        const deptDivIdStr = toIdString(department.divisionId);
        if (deptDivIdStr && divIdStr && deptDivIdStr !== divIdStr) {
          throw new HierarchyValidationError(
            "DIVISION_MISMATCH",
            `User division (${divIdStr}) does not match department division (${deptDivIdStr}).`
          );
        }

        // If department is divisional, but user has no divisionId, reject
        if (deptDivIdStr && !divIdStr) {
          throw new HierarchyValidationError(
            "INVALID_DIVISION_ASSIGNMENT",
            `User assigned to divisional department (${deptIdStr}) must specify matching division.`
          );
        }
      }
    }
    // If not a valid ObjectId or not found, preserve compatibility without throwing CastError
  }

  let team: any = null;
  if (teamIdStr) {
    // Preserve compatibility with legacy string-based User.teamId
    if (isValidObjectIdString(teamIdStr)) {
      team = await Team.findById(teamIdStr).lean();
      if (team) {
        if (toIdString(team.organizationId) !== orgIdStr) {
          throw new HierarchyValidationError(
            "CROSS_TENANT_REFERENCE",
            `User team belongs to organization ${toIdString(team.organizationId)}, not ${orgIdStr}.`
          );
        }

        if (department && toIdString(team.departmentId) !== toIdString(department._id)) {
          throw new HierarchyValidationError(
            "TEAM_DEPARTMENT_MISMATCH",
            `Team ${teamIdStr} belongs to department ${toIdString(team.departmentId)}, not user department ${toIdString(department._id)}.`
          );
        }

        const teamDivIdStr = toIdString(team.divisionId);
        if (teamDivIdStr && divIdStr && teamDivIdStr !== divIdStr) {
          throw new HierarchyValidationError(
            "DIVISION_MISMATCH",
            `User division (${divIdStr}) does not match team division (${teamDivIdStr}).`
          );
        }

        if (requireActive && team.status !== "ACTIVE") {
          throw new HierarchyValidationError("INACTIVE_PARENT_TEAM", `Parent team ${teamIdStr} is inactive.`);
        }
      }
    }
  }

  return { organization, division, department, team };
}

/**
 * 5. Validate Organization/Division → Project → Task relationship
 *
 * Verifies persisted relationships across projects and tasks:
 * - Project belongs to organization.
 * - If Project has divisionId, it must match organization's division.
 * - Cross-division projects must have collaborating divisions in same organization.
 * - Task belongs to organization and Project.
 * - Task division must match Project division or Project's collaborating divisions.
 * - Missing or null divisionId must never grant broader access or classify as Headquarters.
 */
export async function validateProjectTaskHierarchy(params: {
  organizationId: string | mongoose.Types.ObjectId;
  divisionId?: string | mongoose.Types.ObjectId | null;
  projectId?: string | mongoose.Types.ObjectId | null;
  taskId?: string | mongoose.Types.ObjectId | null;
  requireActiveParents?: boolean;
}) {
  const orgIdStr = toIdString(params.organizationId);
  const divIdStr = toIdString(params.divisionId);
  const projectIdStr = toIdString(params.projectId);
  const taskIdStr = toIdString(params.taskId);
  const requireActive = params.requireActiveParents ?? true;

  if (!orgIdStr) {
    throw new HierarchyValidationError("ORGANIZATION_REQUIRED", "Organization ID is required.");
  }

  const organization = await Organization.findById(orgIdStr).lean();
  if (!organization) {
    throw new HierarchyValidationError("ORGANIZATION_NOT_FOUND", `Organization ${orgIdStr} not found.`);
  }
  if (requireActive && organization.status !== "ACTIVE") {
    throw new HierarchyValidationError("INACTIVE_PARENT_ORGANIZATION", "Organization is inactive.");
  }

  let division: any = null;
  if (divIdStr) {
    division = await Division.findById(divIdStr).lean();
    if (!division) {
      throw new HierarchyValidationError("DIVISION_NOT_FOUND", `Division ${divIdStr} not found.`);
    }
    if (toIdString(division.organizationId) !== orgIdStr) {
      throw new HierarchyValidationError("CROSS_TENANT_REFERENCE", "Division belongs to a different organization.");
    }
    if (requireActive && division.status !== "ACTIVE") {
      throw new HierarchyValidationError("INACTIVE_DIVISION", "Division is not active.");
    }
  }

  let project: any = null;
  if (projectIdStr) {
    // Project can be queried by _id or projectId
    project = await Project.findOne({
      $or: [
        ...(isValidObjectIdString(projectIdStr) ? [{ _id: projectIdStr }] : []),
        { projectId: projectIdStr },
      ],
    }).lean();

    if (!project) {
      throw new HierarchyValidationError("PROJECT_NOT_FOUND", `Project ${projectIdStr} not found.`);
    }

    if (toIdString(project.organizationId) !== orgIdStr) {
      throw new HierarchyValidationError("CROSS_TENANT_REFERENCE", "Project belongs to another organization.");
    }

    const projDivIdStr = toIdString(project.divisionId);
    if (divIdStr) {
      const isPrimary = projDivIdStr === divIdStr;
      const isCollaborator =
        project.isCrossDivision &&
        Array.isArray(project.collaboratingDivisionIds) &&
        project.collaboratingDivisionIds.some((id: any) => toIdString(id) === divIdStr);

      if (!isPrimary && !isCollaborator) {
        throw new HierarchyValidationError(
          "PROJECT_DIVISION_MISMATCH",
          `Project does not belong to or collaborate with division ${divIdStr}.`
        );
      }
    }

    // Verify all collaborating divisions belong to same organization
    if (project.isCrossDivision && Array.isArray(project.collaboratingDivisionIds)) {
      for (const colDivId of project.collaboratingDivisionIds) {
        const cDiv = await Division.findById(colDivId).select("organizationId").lean();
        if (!cDiv || toIdString(cDiv.organizationId) !== orgIdStr) {
          throw new HierarchyValidationError(
            "CROSS_TENANT_REFERENCE",
            `Project collaborating division ${toIdString(colDivId)} belongs to a different organization.`
          );
        }
      }
    }
  }

  let task: any = null;
  if (taskIdStr) {
    task = await Task.findOne({
      $or: [
        ...(isValidObjectIdString(taskIdStr) ? [{ _id: taskIdStr }] : []),
        { taskId: taskIdStr },
      ],
    }).lean();

    if (!task) {
      throw new HierarchyValidationError("TASK_NOT_FOUND", `Task ${taskIdStr} not found.`);
    }

    if (toIdString(task.organizationId) !== orgIdStr) {
      throw new HierarchyValidationError("CROSS_TENANT_REFERENCE", "Task belongs to another organization.");
    }

    const taskDivIdStr = toIdString(task.divisionId);
    if (taskDivIdStr) {
      const taskDiv = await Division.findById(taskDivIdStr).lean();
      if (!taskDiv || toIdString(taskDiv.organizationId) !== orgIdStr) {
        throw new HierarchyValidationError("CROSS_TENANT_REFERENCE", "Task division belongs to another organization.");
      }
      if (requireActive && taskDiv.status !== "ACTIVE") {
        throw new HierarchyValidationError("INACTIVE_DIVISION", "Task division is inactive.");
      }
    }

    // If task has a project
    const taskProjId = task.projectId ? toIdString(task.projectId) : null;
    if (taskProjId) {
      if (project && toIdString(project._id) !== taskProjId && project.projectId !== taskProjId) {
        throw new HierarchyValidationError("TASK_PROJECT_MISMATCH", "Task does not belong to the specified project.");
      }

      // Check task division alignment with project
      const parentProj = project || (await Project.findById(taskProjId).lean());
      if (parentProj) {
        if (toIdString(parentProj.organizationId) !== orgIdStr) {
          throw new HierarchyValidationError("CROSS_TENANT_REFERENCE", "Task parent project belongs to another organization.");
        }

        const projDivIdStr = toIdString(parentProj.divisionId);
        if (taskDivIdStr && projDivIdStr) {
          const isPrimary = taskDivIdStr === projDivIdStr;
          const isCollaborator =
            parentProj.isCrossDivision &&
            Array.isArray(parentProj.collaboratingDivisionIds) &&
            parentProj.collaboratingDivisionIds.some((id: any) => toIdString(id) === taskDivIdStr);

          if (!isPrimary && !isCollaborator) {
            throw new HierarchyValidationError(
              "TASK_PROJECT_DIVISION_MISMATCH",
              "Task division does not align with project primary or collaborating divisions."
            );
          }
        }
      }
    }

    if (divIdStr && taskDivIdStr && taskDivIdStr !== divIdStr) {
      throw new HierarchyValidationError(
        "DIVISION_MISMATCH",
        `Task belongs to division ${taskDivIdStr}, not ${divIdStr}.`
      );
    }
  }

  return { organization, division, project, task };
}

/**
 * 6. Validate persisted document hierarchy
 *
 * Inspects an already persisted entity in MongoDB and validates its parent-child
 * integrity based on its actual stored relationships.
 */
export async function validatePersistedHierarchy(
  entityType: "DIVISION" | "DEPARTMENT" | "TEAM" | "USER" | "PROJECT" | "TASK",
  entityId: string | mongoose.Types.ObjectId,
  options?: { organizationId?: string | mongoose.Types.ObjectId; requireActive?: boolean }
) {
  const idStr = toIdString(entityId);
  if (!idStr) {
    throw new HierarchyValidationError("ID_REQUIRED", "Entity ID is required.");
  }

  switch (entityType) {
    case "DIVISION": {
      const div = await Division.findById(idStr).lean();
      if (!div) throw new HierarchyValidationError("DIVISION_NOT_FOUND", "Division not found.");
      return validateOrganizationDivision({
        organizationId: div.organizationId,
        divisionId: div._id,
        requireActive: options?.requireActive,
      });
    }

    case "DEPARTMENT": {
      const dept = await Department.findById(idStr).lean();
      if (!dept) throw new HierarchyValidationError("DEPARTMENT_NOT_FOUND", "Department not found.");
      if (dept.divisionId) {
        return validateDivisionDepartmentTeam({
          organizationId: dept.organizationId,
          departmentId: dept._id,
          divisionId: dept.divisionId,
          requireActive: options?.requireActive,
        });
      }
      return validateOrganizationDepartmentTeam({
        organizationId: dept.organizationId,
        departmentId: dept._id,
        requireActive: options?.requireActive,
      });
    }

    case "TEAM": {
      const team = await Team.findById(idStr).lean();
      if (!team) throw new HierarchyValidationError("TEAM_NOT_FOUND", "Team not found.");
      if (team.divisionId) {
        return validateDivisionDepartmentTeam({
          organizationId: team.organizationId,
          departmentId: team.departmentId,
          teamId: team._id,
          divisionId: team.divisionId,
          requireActive: options?.requireActive,
        });
      }
      return validateOrganizationDepartmentTeam({
        organizationId: team.organizationId,
        departmentId: team.departmentId,
        teamId: team._id,
        requireActive: options?.requireActive,
      });
    }

    case "USER": {
      const user = await User.findById(idStr).lean();
      if (!user) throw new HierarchyValidationError("USER_NOT_FOUND", "User not found.");
      if (!user.organizationId) {
        throw new HierarchyValidationError("ORGANIZATION_REQUIRED", "User has no organization assignment.");
      }
      return validateUserHierarchy({
        organizationId: user.organizationId,
        divisionId: user.divisionId,
        departmentId: user.departmentId,
        teamId: user.teamId,
        userId: user._id,
        requireActiveParents: options?.requireActive,
      });
    }

    case "PROJECT": {
      const project = await Project.findOne({
        $or: [
          ...(isValidObjectIdString(idStr) ? [{ _id: idStr }] : []),
          { projectId: idStr },
        ],
      }).lean();
      if (!project) throw new HierarchyValidationError("PROJECT_NOT_FOUND", "Project not found.");
      return validateProjectTaskHierarchy({
        organizationId: project.organizationId,
        divisionId: project.divisionId,
        projectId: project._id,
        requireActiveParents: options?.requireActive,
      });
    }

    case "TASK": {
      const task = await Task.findOne({
        $or: [
          ...(isValidObjectIdString(idStr) ? [{ _id: idStr }] : []),
          { taskId: idStr },
        ],
      }).lean();
      if (!task) throw new HierarchyValidationError("TASK_NOT_FOUND", "Task not found.");
      return validateProjectTaskHierarchy({
        organizationId: task.organizationId,
        divisionId: task.divisionId,
        projectId: task.projectId,
        taskId: task._id,
        requireActiveParents: options?.requireActive,
      });
    }

    default:
      throw new HierarchyValidationError("INVALID_ENTITY_TYPE", `Unknown entity type: ${entityType}`);
  }
}
