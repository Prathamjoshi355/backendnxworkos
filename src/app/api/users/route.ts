import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import { UserCreateSchema } from "../../../validators/user";
import { DEFAULT_TEMPORARY_PASSWORD } from "../../../validators/auth";
import * as userService from "../../../services/userService";
import { recordAuditLog } from "../../../services/auditLogService";
import { getManagementScope } from "../../../utils/scopeHelper";
import { success, error } from "../../../utils/response";

export async function POST(request: Request) {
  await connectToDatabase();
  const authUser = await getUserFromRequest(request);
  if (!authUser || !requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);

  const body = await request.json();
  const rawRoleCheck = body.role || "EMPLOYEE";
  const rawEmpCheck = body.employmentType || "EMPLOYEE";
  if (!body.password && (rawRoleCheck === "EMPLOYEE" || rawRoleCheck === "INTERN" || rawEmpCheck === "EMPLOYEE" || rawEmpCheck === "INTERN")) {
    body.password = DEFAULT_TEMPORARY_PASSWORD;
  }
  const parsed = UserCreateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

  const rawRole = parsed.data.role;
  if (rawRole === "MANAGER" || rawRole === "TEAM_LEADER") {
    return error(
      "CANNOT_CREATE_LEADERSHIP_DIRECTLY",
      "New employees cannot be created directly as Manager or Team Lead. Create them as an Employee first, then promote them.",
      422
    );
  }

  const jobDesignations = ["DESIGNER", "DEVELOPER", "SALES_EXECUTIVE", "MARKETING", "HR"];
  let finalRole = rawRole || "EMPLOYEE";
  let finalDesignation = parsed.data.designation;

  if (rawRole && jobDesignations.includes(rawRole)) {
    finalDesignation = finalDesignation || rawRole;
    finalRole = "EMPLOYEE";
  }

  if (finalRole && ["SUPER_ADMIN", "ADMIN", "DIVISION_ADMIN"].includes(finalRole)) {
    try {
      const { validateRoleAssignment } = await import("../../../utils/divisionAuth");
      validateRoleAssignment(authUser, finalRole, {
        targetOrgId: authUser.role === "SUPER_ADMIN" ? parsed.data.organizationId : authUser.organizationId,
      });
    } catch (err: any) {
      await recordAuditLog({
        organizationId: String(authUser.organizationId || ""),
        actorId: String(authUser._id),
        actorRole: authUser.role,
        action: "SECURITY_VIOLATION_ROLE_ESCALATION",
        entityType: "USER",
        summary: `Unauthorized attempt to create ${finalRole} user`,
      });
      return error("FORBIDDEN", err.message || "Unauthorized role assignment", 403);
    }
  }

  try {
    const userPayload = {
      ...parsed.data,
      role: finalRole,
      designation: finalDesignation,
      organizationId: authUser.role === "SUPER_ADMIN"
        ? (parsed.data.organizationId || (authUser.organizationId ? String(authUser.organizationId) : undefined))
        : (authUser.organizationId ? String(authUser.organizationId) : undefined),
    };
    const created = await userService.createUser(userPayload);
    await recordAuditLog({
      organizationId: String(created.organizationId || authUser.organizationId || ""),
      actorId: String(authUser._id),
      actorRole: authUser.role,
      action: "USER_CREATED",
      entityType: "USER",
      entityId: String(created._id),
      summary: `Created user ${created.fullName}`,
      metadata: { role: created.role, employmentType: created.employmentType },
    });
    return success({ user: created });
  } catch (err: any) {
    console.error("POST /api/users error:", err);
    if (err.code === 11000) {
      if (err.keyPattern?.email || String(err.message).includes("email")) {
        return error("EMAIL_EXISTS", "Email already exists", 409);
      }
      return error("USER_EXISTS", "User already exists with this employeeId or email", 409);
    }
    if (err.message === "EMAIL_EXISTS") return error("EMAIL_EXISTS", "Email already exists", 409);
    if (err.message === "PASSWORD_REQUIRED") return error("PASSWORD_REQUIRED", "Password is required for user creation", 422);
    if (err.message === "ORG_NOT_FOUND") return error("ORG_NOT_FOUND", "Organization not found", 404);
    if (err.message === "DEPT_NOT_FOUND") return error("DEPT_NOT_FOUND", "Department not found", 404);
    if (err.message === "TEAM_NOT_FOUND") return error("TEAM_NOT_FOUND", "Team not found", 404);
    if (err.message === "DEPT_ORG_MISMATCH") return error("DEPT_ORG_MISMATCH", "Department does not belong to selected organization", 422);
    if (err.name === "ValidationError") return error("VALIDATION_ERROR", err.message, 422);
    return error("INTERNAL_ERROR", err.message || "Unable to create user", 500);
  }
}

export async function GET(request: Request) {
  await connectToDatabase();
  const authUser = await getUserFromRequest(request);
  if (!authUser) return error("UNAUTHORIZED", "Not authenticated", 401);

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || "1");
  const limit = Number(url.searchParams.get("limit") || "50");
  const search = url.searchParams.get("search") || undefined;
  const role = url.searchParams.get("role") || undefined;
  const employmentType = url.searchParams.get("employmentType") || undefined;
  const departmentId = url.searchParams.get("departmentId") || undefined;
  const teamId = url.searchParams.get("teamId") || undefined;
  const status = url.searchParams.get("status") || undefined;

  const filters: any = {};
  if (role) filters.role = role;
  if (employmentType) filters.employmentType = employmentType;
  if (departmentId) filters.departmentId = departmentId;
  if (teamId) filters.teamId = teamId;
  if (status) filters.status = status;

  if (authUser.role === "SUPER_ADMIN") {
    const orgParam = url.searchParams.get("organizationId");
    if (orgParam) filters.organizationId = orgParam;
  } else if (authUser.role === "ADMIN") {
    filters.organizationId = authUser.organizationId;
  } else {
    // MANAGER, TEAM_LEADER, EMPLOYEE
    const scope = await getManagementScope(authUser);
    filters.organizationId = authUser.organizationId;
    if (scope.scopedUserIds.length > 0) {
      filters._id = { $in: scope.scopedUserIds };
    } else {
      filters._id = authUser._id;
    }
  }

  const res = await userService.listUsers({ page, limit, search, filters });
  return success(res);
}
