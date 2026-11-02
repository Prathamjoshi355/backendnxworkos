import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { setTeamStatus } from "../../../../../services/teamService";
import { recordAuditLog } from "../../../../../services/auditLogService";
import { success, error } from "../../../../../utils/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  const { id } = await context.params;
  const body = await request.json();
  const status = String(body.status || "");
  if (!["ACTIVE", "INACTIVE"].includes(status)) return error("VALIDATION_ERROR", "Invalid team status", 422);
  const updated = await setTeamStatus(id, status);
  if (!updated) return error("NOT_FOUND", "Team not found", 404);
  await recordAuditLog({
    organizationId: String(updated.organizationId || user.organizationId || ""),
    actorId: String(user._id),
    actorRole: user.role,
    action: "TEAM_UPDATED",
    entityType: "TEAM",
    entityId: id,
    summary: `Updated team status to ${status}`,
  });
  return success({ team: updated });
}
