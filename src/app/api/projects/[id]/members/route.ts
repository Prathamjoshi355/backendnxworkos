import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as projectService from "../../../../../services/projectService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : body.memberId ? [body.memberId] : [];
    if (memberIds.length === 0) return error("VALIDATION_ERROR", "memberIds required", 422);

    const updated = await projectService.addProjectMembers((await context.params).id, memberIds, user);
    return success({ project: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to add members";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "PROJECT_NOT_FOUND") return error("NOT_FOUND", "Project not found", 404);
    return error("PROJECT_MEMBERS_ADD_FAILED", message, 500);
  }
}
