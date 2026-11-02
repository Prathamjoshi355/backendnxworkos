import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { updateLeadershipRole } from "../../../../../services/hierarchyService";
import { success, error } from "../../../../../utils/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser || !requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "You do not have permission to perform this action.", 403);
    }

    const { id } = await context.params;
    const body = await request.json();

    if (!body.action) {
      return error("VALIDATION_ERROR", "Action is required", 422);
    }

    const validActions = [
      "MAKE_MANAGER",
      "MAKE_TEAM_LEAD",
      "REMOVE_MANAGER",
      "REMOVE_TEAM_LEAD",
      "REASSIGN_TEAM",
      "REASSIGN_MANAGER",
      "ASSIGN_TEAM_MANAGER",
      "ASSIGN_TEAM_LEAD",
    ];

    if (!validActions.includes(body.action)) {
      return error("VALIDATION_ERROR", `Invalid action. Supported: ${validActions.join(", ")}`, 422);
    }

    const updated = await updateLeadershipRole(authUser, id, body);
    return success({ user: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to update leadership role";
    if (message === "USER_NOT_FOUND") return error("NOT_FOUND", "User not found", 404);
    if (message === "TEAM_NOT_FOUND") return error("NOT_FOUND", "Selected team does not belong to this organization.", 404);
    if (message === "MANAGER_NOT_FOUND") return error("NOT_FOUND", "Selected manager is not valid for this organization.", 404);
    if (message === "TEAM_LEAD_NOT_FOUND") return error("NOT_FOUND", "Team Lead must belong to the selected team.", 404);
    if (message === "FORBIDDEN_ORG_MISMATCH" || message === "TEAM_ORG_MISMATCH" || message === "MANAGER_ORG_MISMATCH" || message === "TEAM_LEAD_ORG_MISMATCH") {
      return error("FORBIDDEN", "Cross-organization access is not allowed.", 403);
    }
    if (message === "CIRCULAR_REPORTING_DETECTED") {
      return error("VALIDATION_ERROR", "Circular reporting relationship detected", 422);
    }
    if (message === "TEAM_ID_REQUIRED" || message === "MANAGER_ID_REQUIRED") {
      return error("VALIDATION_ERROR", message, 422);
    }
    console.error("PATCH /api/users/[id]/leadership error:", err);
    return error("LEADERSHIP_UPDATE_FAILED", message, 500);
  }
}
