import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import { TeamCreateSchema } from "../../../validators/team";
import * as teamService from "../../../services/teamService";
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
  const parsed = TeamCreateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

  try {
    const created = await teamService.createTeam(parsed.data);
    await recordAuditLog({
      organizationId: String(created.organizationId || user.organizationId || ""),
      actorId: String(user._id),
      actorRole: user.role,
      action: "TEAM_CREATED",
      entityType: "TEAM",
      entityId: String(created._id),
      summary: `Created team ${created.name}`,
    });
    return success({ team: created }, 201);
  } catch (err: any) {
    if (err.message === "ORG_NOT_FOUND") return error("ORG_NOT_FOUND", "Organization not found", 404);
    if (err.message === "DEPT_NOT_FOUND") return error("DEPT_NOT_FOUND", "Department not found", 404);
    if (err.message === "DEPT_ORG_MISMATCH") return error("DEPT_ORG_MISMATCH", "Department does not belong to organization", 400);
    console.error(err);
    return error("INTERNAL_ERROR", "Unable to create team", 500);
  }
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const targetManagerId = url.searchParams.get("managerId") || undefined;

    const filter: Record<string, any> = {};

    if (user.role === "SUPER_ADMIN") {
      const orgParam = url.searchParams.get("organizationId");
      if (orgParam) filter.organizationId = orgParam;
      if (targetManagerId) filter.managerId = targetManagerId;
    } else if (user.role === "ADMIN") {
      if (user.organizationId) {
        filter.organizationId = user.organizationId;
      }
      if (targetManagerId) filter.managerId = targetManagerId;
    } else if (user.role === "MANAGER") {
      if (user.organizationId) filter.organizationId = user.organizationId;
      filter.$or = [{ managerId: String(user._id || user.id) }, { teamLeadId: String(user._id || user.id) }];
    } else if (user.role === "TEAM_LEADER") {
      if (user.organizationId) filter.organizationId = user.organizationId;
      filter.$or = [
        { teamLeadId: String(user._id || user.id) },
        ...(user.teamId ? [{ _id: user.teamId }] : []),
      ];
    } else {
      if (user.organizationId) filter.organizationId = user.organizationId;
      if (user.teamId) {
        filter._id = user.teamId;
      } else {
        return success({ items: [], total: 0 });
      }
    }

    if (departmentId) filter.departmentId = departmentId;
    if (status) filter.status = status;

    const res = await teamService.listTeams(filter, { skip: (page - 1) * limit, limit });
    return success(res);
  } catch (err: any) {
    console.error("GET /api/teams error:", err);
    return error("TEAMS_FETCH_FAILED", err?.message || "Unable to fetch teams", 500);
  }
}
