import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as projectService from "../../../../services/projectService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const project = await projectService.getProjectById((await context.params).id, user);
    return success({ project });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to get project";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "PROJECT_NOT_FOUND") return error("NOT_FOUND", "Project not found", 404);
    return error("PROJECT_GET_FAILED", message, 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    const updated = await projectService.updateProject((await context.params).id, user, body);
    return success({ project: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to update project";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "PROJECT_NOT_FOUND") return error("NOT_FOUND", "Project not found", 404);
    return error("PROJECT_UPDATE_FAILED", message, 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const archived = await projectService.archiveProject((await context.params).id, user);
    return success({ project: archived });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to archive project";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "PROJECT_NOT_FOUND") return error("NOT_FOUND", "Project not found", 404);
    return error("PROJECT_DELETE_FAILED", message, 500);
  }
}
