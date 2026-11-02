import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as fileService from "../../../../../services/fileService";
import { success, error } from "../../../../../utils/response";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const resolvedParams = await context.params;
    const fileId = resolvedParams.id;

    const file = await fileService.restoreFile(user, fileId);
    return success({ file });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to restore file";
    if (msg === "FILE_NOT_FOUND") {
      return error("NOT_FOUND", "File not found", 404);
    }
    if (msg === "FORBIDDEN_FILE_RESTORE") {
      return error("FORBIDDEN", "Forbidden - unauthorized to restore file", 403);
    }
    return error("RESTORE_FAILED", msg, 500);
  }
}
