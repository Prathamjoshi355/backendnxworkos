import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import { DepartmentCreateSchema } from "../../../validators/department";
import * as deptService from "../../../services/departmentService";
import { recordAuditLog } from "../../../services/auditLogService";
import { success, error } from "../../../utils/response";

export async function POST(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);

  const body = await request.json();
  if (user.role === "ADMIN") {
    body.organizationId = String(user.organizationId);
  }

  // Idempotent initialization of 12 default departments (Section 4)
  if (body.action === "INITIALIZE_DEFAULTS") {
    const orgId = user.role === "SUPER_ADMIN" ? (body.organizationId || user.organizationId) : user.organizationId;
    if (!orgId) return error("VALIDATION_ERROR", "organizationId is required", 422);

    try {
      const result = await deptService.initializeDefaultDepartmentsForOrg(orgId, {
        divisionId: body.divisionId || null,
        isCentral: body.isCentral,
      });
      return success({
        message: "Default departments initialized successfully",
        createdCount: result.created.length,
        existingCount: result.existing.length,
        departments: [...result.existing, ...result.created],
      });
    } catch (err: any) {
      return error("INITIALIZATION_FAILED", err.message || "Failed to initialize default departments", 500);
    }
  }

  const parsed = DepartmentCreateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

  try {
    const created = await deptService.createDepartment(parsed.data);
    await recordAuditLog({
      organizationId: String(created.organizationId || user.organizationId || ""),
      actorId: String(user._id),
      actorRole: user.role,
      action: "DEPARTMENT_CREATED",
      entityType: "DEPARTMENT",
      entityId: String(created._id),
      summary: `Created department ${created.name}`,
    });
    return success({ department: created });
  } catch (err: any) {
    if (err.message === "ORG_NOT_FOUND") return error("ORG_NOT_FOUND", "Organization not found", 404);
    console.error(err);
    return error("INTERNAL_ERROR", "Unable to create department", 500);
  }
}

export async function GET(request: Request) {
  await connectToDatabase();
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || "1");
  const limit = Number(url.searchParams.get("limit") || "20");
  const organizationId = url.searchParams.get("organizationId") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const filter: Record<string, string> = {};
  if (organizationId) filter.organizationId = organizationId;
  if (status) filter.status = status;
  const res = await deptService.listDepartments(filter, { skip: (page - 1) * limit, limit });
  return success(res);
}
