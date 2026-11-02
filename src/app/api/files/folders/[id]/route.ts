import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as fileService from "../../../../../services/fileService";
import { success, error } from "../../../../../utils/response";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const resolvedParams = await context.params;
    const folderId = resolvedParams.id;

    const folder = await fileService.deleteFolder(user, folderId);
    return success({ folder });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to delete folder";
    if (msg === "FOLDER_NOT_FOUND") {
      return error("NOT_FOUND", "Folder not found", 404);
    }
    if (msg === "FORBIDDEN_FOLDER_DELETE") {
      return error("FORBIDDEN", "Forbidden - cannot delete this folder", 403);
    }
    return error("FOLDER_DELETE_FAILED", msg, 500);
  }
}
