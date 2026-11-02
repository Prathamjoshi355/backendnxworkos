import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import * as teamService from "../../../../services/teamService";
import { recordAuditLog } from "../../../../services/auditLogService";
import { TeamUpdateSchema } from "../../../../validators/team";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await context.params;
  const t = await teamService.getTeamById(id);
  if (!t) return error("NOT_FOUND", "Team not found", 404);

  if (user.role === "SUPER_ADMIN") {
    return success({ team: t });
  }

  // Strict organization isolation
  if (t.organizationId && String(t.organizationId) !== String(user.organizationId)) {
    return error("FORBIDDEN", "Forbidden - team belongs to another organization", 403);
  }

  if (user.role === "ADMIN") {
    return success({ team: t });
  }

  if (user.role === "MANAGER") {
    const mgr: any = t.managerId;
    const teamMgrId = mgr?._id ? String(mgr._id) : mgr ? String(mgr) : null;
    if (teamMgrId !== String(user._id)) {
      return error("FORBIDDEN", "Forbidden - team not managed by this manager", 403);
    }
    return success({ team: t });
  }

  if (user.role === "TEAM_LEADER") {
    const lead: any = t.teamLeadId;
    const teamLeadId = lead?._id ? String(lead._id) : lead ? String(lead) : null;
    if (teamLeadId !== String(user._id) && String(user.teamId) !== String(t._id)) {
      return error("FORBIDDEN", "Forbidden - not assigned to this team", 403);
    }
    return success({ team: t });
  }

  // Regular employee
  if (String(user.teamId) !== String(t._id)) {
    return error("FORBIDDEN", "Forbidden - not a member of this team", 403);
  }

  return success({ team: t });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  const { id } = await context.params;
  
  const existingTeam = await teamService.getTeamById(id);
  if (!existingTeam) return error("NOT_FOUND", "Team not found", 404);

  // Organization isolation
  if (user.role !== "SUPER_ADMIN" && existingTeam.organizationId && String(existingTeam.organizationId) !== String(user.organizationId)) {
    return error("FORBIDDEN", "Forbidden - team belongs to another organization", 403);
  }

  const body = await request.json();
  if (user.role !== "SUPER_ADMIN") {
    delete body.organizationId;
  }
  const parsed = TeamUpdateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

  try {
    const updated = await teamService.updateTeam(id, parsed.data);
    if (updated) {
      let action = "TEAM_UPDATED";
      let summary = `Updated team ${updated.name}`;

      if (parsed.data.teamLeadId !== undefined) {
        action = existingTeam.teamLeadId ? "TEAM_LEAD_REPLACED" : "TEAM_LEAD_ASSIGNED";
        summary = `Assigned Team Lead to team ${updated.name}`;
      } else if (parsed.data.managerId !== undefined) {
        action = "TEAM_MANAGER_ASSIGNED";
        summary = `Assigned Manager to team ${updated.name}`;
      }

      await recordAuditLog({
        organizationId: String(updated.organizationId || user.organizationId || ""),
        actorId: String(user._id),
        actorRole: user.role,
        action,
        entityType: "TEAM",
        entityId: id,
        summary,
        metadata: {
          changedBy: String(user._id),
          targetTeam: id,
          previousManager: existingTeam.managerId || null,
          newManager: parsed.data.managerId || existingTeam.managerId || null,
          previousTeamLead: existingTeam.teamLeadId || null,
          newTeamLead: parsed.data.teamLeadId || existingTeam.teamLeadId || null,
          timestamp: new Date().toISOString(),
          organizationId: String(updated.organizationId || user.organizationId || ""),
        },
      });
    }
    return success({ team: updated });
  } catch (err: any) {
    if (err.message === "ORG_NOT_FOUND") return error("ORG_NOT_FOUND", "Organization not found", 404);
    if (err.message === "DEPT_NOT_FOUND") return error("DEPT_NOT_FOUND", "Department not found", 404);
    if (err.message === "DEPT_ORG_MISMATCH") return error("DEPT_ORG_MISMATCH", "Department does not belong to organization", 400);
    console.error(err);
    return error("INTERNAL_ERROR", "Unable to update team", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Forbidden", 403);
  const { id } = await context.params;

  const existingTeam = await teamService.getTeamById(id);
  if (!existingTeam) return error("NOT_FOUND", "Team not found", 404);

  // Organization isolation
  if (user.role !== "SUPER_ADMIN" && existingTeam.organizationId && String(existingTeam.organizationId) !== String(user.organizationId)) {
    return error("FORBIDDEN", "Forbidden - team belongs to another organization", 403);
  }

  const updated = await teamService.setTeamStatus(id, "INACTIVE");
  if (!updated) return error("NOT_FOUND", "Team not found", 404);
  return success({ team: updated });
}
