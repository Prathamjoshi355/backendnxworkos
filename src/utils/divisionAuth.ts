import mongoose from "mongoose";
import Division from "../models/Division";

function checkCompensationPermission(user: any, permission: string): boolean {
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  const explicit = user.permissions || [];
  if (Array.isArray(explicit) && explicit.includes(permission)) return true;
  return false;
}

export class DivisionAuthError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(`${code}: ${message}`);
    this.name = "DivisionAuthError";
    this.code = code;
    this.details = details;
  }
}

export type DivisionAction =
  | "read"
  | "view"
  | "create"
  | "edit"
  | "update"
  | "delete"
  | "archive"
  | "manage";

export type DivisionDomain = "general" | "compensation" | "hr" | "file";

export interface DivisionAccessOptions {
  action?: DivisionAction;
  domain?: DivisionDomain;
  targetDivisionId?: string | mongoose.Types.ObjectId | null;
  targetOrganizationId?: string | mongoose.Types.ObjectId | null;
  requireActiveDivision?: boolean;
}

function toIdString(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") return val.trim();
  if (val instanceof mongoose.Types.ObjectId) return val.toString();
  if (val._id) return toIdString(val._id);
  return String(val).trim();
}

/**
 * Checks whether an authenticated user has access to a division or divisional resource.
 *
 * Enforces boundaries:
 * - SUPER_ADMIN: platform-level access.
 * - ADMIN: organization-scoped access, subject to domain permissions.
 * - DIVISION_ADMIN: strictly limited to explicitly assigned, valid, active division.
 * - Missing or null division assignment for DIVISION_ADMIN: deny access.
 * - Central and legacy unclassified records: no implicit access for division administrators.
 * - Cross-division collaboration: no automatic edit access based solely on collaboration metadata.
 * - Compensation, central HR, and private files: no expanded permissions by default.
 */
export async function hasDivisionAccess(
  actor: any,
  target?: any,
  options: DivisionAccessOptions = {}
): Promise<boolean> {
  if (!actor) return false;

  const role = actor.role || "EMPLOYEE";
  const actorOrgId = toIdString(actor.organizationId);
  const action = options.action || "read";
  const domain = options.domain || "general";

  // 1. SUPER_ADMIN: Full platform-level access
  if (role === "SUPER_ADMIN") {
    return true;
  }

  // 2. Organization tenant boundary check for all other roles
  if (options.targetOrganizationId) {
    if (toIdString(options.targetOrganizationId) !== actorOrgId) {
      return false;
    }
  }

  if (target && target.organizationId) {
    if (toIdString(target.organizationId) !== actorOrgId) {
      return false;
    }
  }

  // 3. ADMIN: Organization-scoped access
  if (role === "ADMIN") {
    // Domain protections for ADMIN
    if (domain === "compensation") {
      return checkCompensationPermission(actor, "compensation.view") ||
        checkCompensationPermission(actor, "compensation.manage");
    }

    if (domain === "file" && target) {
      if (target.visibility === "PRIVATE") {
        const isOwner = toIdString(target.ownerId) === toIdString(actor._id);
        const isUploader = toIdString(target.uploadedBy) === toIdString(actor._id);
        if (!isOwner && !isUploader) {
          const perms = actor.permissions || [];
          if (!perms.includes("file.private.view") && !perms.includes("file.manage")) {
            return false;
          }
        }
      }
    }

    return true;
  }

  // 4. DIVISION_ADMIN: Strictly scoped to assigned, active division
  if (role === "DIVISION_ADMIN") {
    const actorDivId = toIdString(actor.divisionId || actor.primaryDivisionId);

    // Missing or null division assignment: deny access
    if (!actorDivId) {
      return false;
    }

    // Verify division exists and is ACTIVE
    const divisionDoc = await Division.findById(actorDivId).lean();
    if (!divisionDoc) {
      return false;
    }

    if (toIdString(divisionDoc.organizationId) !== actorOrgId) {
      return false;
    }

    if (divisionDoc.status !== "ACTIVE") {
      return false;
    }

    // Domain protections: Compensation, central HR, private files deny expanded access
    if (domain === "compensation") {
      return checkCompensationPermission(actor, "compensation.view") ||
        checkCompensationPermission(actor, "compensation.manage");
    }

    if (domain === "hr") {
      const perms = actor.permissions || [];
      if (!perms.includes("hr.manage")) {
        return false;
      }
    }

    if (domain === "file" && target) {
      if (target.visibility === "PRIVATE") {
        const isOwner = toIdString(target.ownerId) === toIdString(actor._id);
        const isUploader = toIdString(target.uploadedBy) === toIdString(actor._id);
        if (!isOwner && !isUploader) return false;
      }
    }

    // Explicit divisionId check in options
    if (options.targetDivisionId !== undefined) {
      const targetDivStr = toIdString(options.targetDivisionId);
      if (!targetDivStr || targetDivStr !== actorDivId) {
        return false;
      }
    }

    // Target object evaluation
    if (target) {
      // Direct Division target
      if (target.code && target.status && target.name && target._id) {
        return toIdString(target._id) === actorDivId;
      }

      // Central records: no implicit access for division administrators
      if (target.isCentral === true) {
        return false;
      }

      // Legacy and unclassified records (divisionId is null/undefined): no implicit access
      const targetDivId = toIdString(target.divisionId);
      if (!targetDivId) {
        return false;
      }

      // Cross-division collaboration: no automatic edit access based solely on collaboration metadata
      const isPrimary = targetDivId === actorDivId;
      if (isPrimary) {
        return true;
      }

      // Check if project has cross-division collaboration metadata
      const isCrossDivProject =
        target.isCrossDivision === true &&
        Array.isArray(target.collaboratingDivisionIds) &&
        target.collaboratingDivisionIds.some((id: any) => toIdString(id) === actorDivId);

      if (isCrossDivProject) {
        // Read access permitted for collaborating division
        if (action === "read" || action === "view") {
          return true;
        }
        // Edit/write access denied based solely on collaboration metadata
        return false;
      }

      // Mismatch
      return false;
    }

    return true;
  }

  // 5. Other roles (MANAGER, TEAM_LEADER, EMPLOYEE, etc.)
  const userDivId = toIdString(actor.divisionId || actor.primaryDivisionId);
  if (target) {
    if (target.isCentral === true) {
      // Central records only accessible if user is in central or authorized
      return true;
    }
    const targetDivId = toIdString(target.divisionId);
    if (targetDivId && userDivId && targetDivId !== userDivId) {
      // Check cross-division read collaboration for project
      if (
        (action === "read" || action === "view") &&
        target.isCrossDivision === true &&
        Array.isArray(target.collaboratingDivisionIds) &&
        target.collaboratingDivisionIds.some((id: any) => toIdString(id) === userDivId)
      ) {
        return true;
      }
      return false;
    }
  }

  return true;
}

/**
 * Validates division scope and throws a descriptive DivisionAuthError if denied.
 */
export async function validateDivisionScope(
  actor: any,
  target?: any,
  options: DivisionAccessOptions = {}
): Promise<void> {
  if (!actor) {
    throw new DivisionAuthError("UNAUTHORIZED", "Authentication required for division scope access.");
  }

  const role = actor.role || "EMPLOYEE";
  const actorOrgId = toIdString(actor.organizationId);
  const action = options.action || "read";
  const domain = options.domain || "general";

  if (role === "SUPER_ADMIN") {
    return;
  }

  if (options.targetOrganizationId && toIdString(options.targetOrganizationId) !== actorOrgId) {
    throw new DivisionAuthError(
      "CROSS_TENANT_ACCESS_DENIED",
      "Access denied across organization tenant boundaries."
    );
  }

  if (target && target.organizationId && toIdString(target.organizationId) !== actorOrgId) {
    throw new DivisionAuthError(
      "CROSS_TENANT_ACCESS_DENIED",
      "Target resource belongs to a different organization."
    );
  }

  if (role === "DIVISION_ADMIN") {
    const actorDivId = toIdString(actor.divisionId || actor.primaryDivisionId);
    if (!actorDivId) {
      throw new DivisionAuthError(
        "NULL_DIVISION_ASSIGNMENT",
        "Division administrator has no assigned division."
      );
    }

    const divisionDoc = await Division.findById(actorDivId).lean();
    if (!divisionDoc) {
      throw new DivisionAuthError("DIVISION_NOT_FOUND", "Assigned division does not exist.");
    }
    if (toIdString(divisionDoc.organizationId) !== actorOrgId) {
      throw new DivisionAuthError(
        "CROSS_TENANT_ACCESS_DENIED",
        "Assigned division belongs to another organization."
      );
    }
    if (divisionDoc.status !== "ACTIVE") {
      throw new DivisionAuthError(
        "INACTIVE_DIVISION",
        `Assigned division is inactive (status: ${divisionDoc.status}).`
      );
    }

    if (domain === "compensation") {
      const allowed =
        checkCompensationPermission(actor, "compensation.view") ||
        checkCompensationPermission(actor, "compensation.manage");
      if (!allowed) {
        throw new DivisionAuthError(
          "COMPENSATION_ACCESS_DENIED",
          "Division administrators do not have expanded compensation permissions by default."
        );
      }
    }

    if (domain === "hr") {
      const perms = actor.permissions || [];
      if (!perms.includes("hr.manage")) {
        throw new DivisionAuthError(
          "HR_ACCESS_DENIED",
          "Division administrators do not have central HR permissions by default."
        );
      }
    }

    if (options.targetDivisionId !== undefined) {
      const targetDivStr = toIdString(options.targetDivisionId);
      if (!targetDivStr || targetDivStr !== actorDivId) {
        throw new DivisionAuthError(
          "DIVISION_ACCESS_DENIED",
          "Access denied: Target division does not match assigned division."
        );
      }
    }

    if (target) {
      // Direct Division target
      if (target.code && target.name && target._id) {
        if (toIdString(target._id) !== actorDivId) {
          throw new DivisionAuthError(
            "DIVISION_ACCESS_DENIED",
            `Target division (${toIdString(target._id)}) does not match assigned division (${actorDivId}).`
          );
        }
        return;
      }

      if (target.isCentral === true) {
        throw new DivisionAuthError(
          "CENTRAL_RECORD_ACCESS_DENIED",
          "Division administrators have no implicit access to central headquarters records."
        );
      }

      const targetDivId = toIdString(target.divisionId);
      if (!targetDivId) {
        throw new DivisionAuthError(
          "UNCLASSIFIED_RECORD_ACCESS_DENIED",
          "Division administrators have no implicit access to legacy unclassified records."
        );
      }

      if (targetDivId !== actorDivId) {
        const isCrossDivProject =
          target.isCrossDivision === true &&
          Array.isArray(target.collaboratingDivisionIds) &&
          target.collaboratingDivisionIds.some((id: any) => toIdString(id) === actorDivId);

        if (isCrossDivProject) {
          if (["edit", "update", "delete", "manage", "create"].includes(action)) {
            throw new DivisionAuthError(
              "CROSS_DIVISION_EDIT_DENIED",
              "Cross-division collaboration metadata does not grant edit access to collaborating divisions."
            );
          }
          return;
        }

        throw new DivisionAuthError(
          "DIVISION_ACCESS_DENIED",
          `Resource belongs to division ${targetDivId}, not assigned division ${actorDivId}.`
        );
      }
    }

    return;
  }

  const allowed = await hasDivisionAccess(actor, target, options);
  if (!allowed) {
    throw new DivisionAuthError(
      "DIVISION_ACCESS_DENIED",
      "Access denied outside authorized division or organization scope."
    );
  }
}

/**
 * Validates role assignment authorization.
 *
 * Enforces that unauthorized users cannot assign ADMIN, SUPER_ADMIN, or DIVISION_ADMIN
 * through user creation, update, or alternate role-assignment paths.
 */
export function validateRoleAssignment(
  actor: any,
  targetRole?: string | null,
  options?: { targetOrgId?: string | mongoose.Types.ObjectId | null }
): void {
  if (!targetRole) return;

  const role = targetRole.toUpperCase();
  const privilegedRoles = ["SUPER_ADMIN", "ADMIN", "DIVISION_ADMIN"];
  if (!privilegedRoles.includes(role)) {
    return;
  }

  if (!actor) {
    throw new DivisionAuthError(
      "UNAUTHORIZED_ROLE_ASSIGNMENT",
      "Authentication required to assign administrative roles."
    );
  }

  const actorRole = actor.role || "EMPLOYEE";
  const actorOrgId = toIdString(actor.organizationId);
  const targetOrgId = toIdString(options?.targetOrgId);

  // SUPER_ADMIN assignment: strictly only SUPER_ADMIN
  if (role === "SUPER_ADMIN") {
    if (actorRole !== "SUPER_ADMIN") {
      throw new DivisionAuthError(
        "UNAUTHORIZED_ROLE_ASSIGNMENT",
        "Only Super Admin can assign SUPER_ADMIN role."
      );
    }
    return;
  }

  // ADMIN assignment: SUPER_ADMIN, or ADMIN within same organization
  if (role === "ADMIN") {
    if (actorRole !== "SUPER_ADMIN" && actorRole !== "ADMIN") {
      throw new DivisionAuthError(
        "UNAUTHORIZED_ROLE_ASSIGNMENT",
        "Unauthorized role escalation: only Super Admin or Admin can assign ADMIN role."
      );
    }
    if (actorRole === "ADMIN" && targetOrgId && targetOrgId !== actorOrgId) {
      throw new DivisionAuthError(
        "CROSS_TENANT_ROLE_ASSIGNMENT",
        "Admin cannot assign ADMIN role outside their organization."
      );
    }
    return;
  }

  // DIVISION_ADMIN assignment: SUPER_ADMIN, or ADMIN within same organization
  if (role === "DIVISION_ADMIN") {
    if (actorRole !== "SUPER_ADMIN" && actorRole !== "ADMIN") {
      throw new DivisionAuthError(
        "UNAUTHORIZED_ROLE_ASSIGNMENT",
        "Unauthorized role escalation: only Super Admin or Admin can assign DIVISION_ADMIN role."
      );
    }
    if (actorRole === "ADMIN" && targetOrgId && targetOrgId !== actorOrgId) {
      throw new DivisionAuthError(
        "CROSS_TENANT_ROLE_ASSIGNMENT",
        "Admin cannot assign DIVISION_ADMIN role outside their organization."
      );
    }
    return;
  }
}
