import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as hrService from "../../../../services/hrService";
import * as userService from "../../../../services/userService";
import { recordAuditLog } from "../../../../services/auditLogService";
import { emitEmployeeCreated } from "../../../../lib/socketEmitters";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const url = new URL(request.url);
    const query: any = {
      page: url.searchParams.get("page") || "1",
      limit: url.searchParams.get("limit") || "50",
      search: url.searchParams.get("search") || undefined,
      departmentId: url.searchParams.get("departmentId") || undefined,
      teamId: url.searchParams.get("teamId") || undefined,
      designation: url.searchParams.get("designation") || undefined,
      role: url.searchParams.get("role") || undefined,
      employmentType: url.searchParams.get("employmentType") || undefined,
      employmentStatus: url.searchParams.get("employmentStatus") || undefined,
      onboardingStatus: url.searchParams.get("onboardingStatus") || undefined,
      activeOnly: url.searchParams.get("activeOnly") || undefined,
      organizationId: url.searchParams.get("organizationId") || undefined,
    };

    const result = await hrService.listEmployees(user, query);
    return success(result);
  } catch (err: any) {
    console.error("GET /api/hr/employees error:", err);
    return error("FAILED", err.message || "Failed to list employees", 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!hrService.isHrOrAdmin(user)) {
      return error("FORBIDDEN", "Forbidden - requires HR or Admin role", 403);
    }

    const body = await request.json();
    if (!body.email || !body.fullName) {
      return error("VALIDATION_ERROR", "Full name and email are required", 422);
    }

    const targetOrgId = user.role === "SUPER_ADMIN" && body.organizationId ? body.organizationId : user.organizationId;
    if (!targetOrgId) {
      return error("VALIDATION_ERROR", "Organization ID required", 422);
    }

    // Validate role assignment authorization (prevents unauthorized role escalation)
    if (body.role) {
      const { validateRoleAssignment } = await import("../../../../utils/divisionAuth");
      validateRoleAssignment(user, body.role, { targetOrgId });
    }

    // Validate manager assignment if specified
    if (body.reportingManagerId) {
      // Temporary check against new employee
      await hrService.validateManagerAssignment("NEW_USER", body.reportingManagerId, String(targetOrgId));
    }

    const payload = {
      ...body,
      organizationId: targetOrgId,
      status: body.status || "PROBATION",
      employmentStatus: body.employmentStatus || body.status || "PROBATION",
      password: body.password || "TempPass123!",
    };

    const created = await userService.createUser(payload);

    // Initialize onboarding checklist
    const User = (await import("../../../../models/User")).default;
    const checklist = hrService.DEFAULT_ONBOARDING_CHECKLIST.map((c) => ({
      key: c.key,
      title: c.title,
      completed: false,
      completedAt: null,
      completedBy: null,
    }));

    await User.findByIdAndUpdate(created._id, {
      onboardingStatus: "PENDING",
      onboardingChecklist: checklist,
      joiningDate: body.joiningDate ? new Date(body.joiningDate) : new Date(),
      probationEndDate: body.probationEndDate ? new Date(body.probationEndDate) : null,
    });

    await recordAuditLog({
      organizationId: String(targetOrgId),
      actorId: String(user._id || user.id),
      actorRole: user.role,
      action: "EMPLOYEE_ONBOARDED",
      entityType: "USER",
      entityId: String(created._id),
      summary: `Onboarded new employee ${created.fullName} (${created.employeeId || ""})`,
      metadata: { role: created.role, designation: created.designation },
    });

    emitEmployeeCreated(created, targetOrgId);

    return success({ employee: created }, 201);
  } catch (err: any) {
    console.error("POST /api/hr/employees error:", err);
    if (err.message === "EMAIL_EXISTS") return error("EMAIL_EXISTS", "Email already registered", 409);
    if (err.message === "CANNOT_MANAGE_SELF") return error("CANNOT_MANAGE_SELF", "Employee cannot be their own manager", 422);
    if (err.message === "MANAGER_CROSS_ORG_FORBIDDEN") return error("MANAGER_CROSS_ORG_FORBIDDEN", "Manager belongs to another organization", 422);
    if (err.name === "DivisionAuthError" || err.code === "UNAUTHORIZED_ROLE_ASSIGNMENT" || err.code === "CROSS_TENANT_ROLE_ASSIGNMENT") {
      return error("FORBIDDEN", err.message || "Unauthorized role assignment", 403);
    }
    return error("FAILED", err.message || "Failed to onboard employee", 500);
  }
}
