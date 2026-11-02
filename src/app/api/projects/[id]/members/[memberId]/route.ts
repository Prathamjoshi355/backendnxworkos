import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as projectService from "../../../../../../services/projectService";
import { success, error } from "../../../../../../utils/response";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const params = await context.params;
    const updated = await projectService.removeProjectMember(params.id, params.memberId, user);
    return success({ project: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to remove member";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "PROJECT_NOT_FOUND") return error("NOT_FOUND", "Project not found", 404);
    return error("PROJECT_MEMBER_REMOVE_FAILED", message, 500);
  }
}
