import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as fileService from "../../../../services/fileService";
import { success, error } from "../../../../utils/response";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const resolvedParams = await context.params;
    const fileId = resolvedParams.id;

    const file = await fileService.getFileById(user, fileId);
    return success({ file });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to retrieve file";
    if (msg === "FILE_NOT_FOUND") {
      return error("NOT_FOUND", "File not found", 404);
    }
    if (msg === "FORBIDDEN_FILE_ACCESS") {
      return error("FORBIDDEN", "Forbidden - unauthorized file access", 403);
    }
    return error("FILE_GET_FAILED", msg, 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const resolvedParams = await context.params;
    const fileId = resolvedParams.id;
    const body = await request.json();

    const file = await fileService.updateFileMetadata(user, fileId, body);
    return success({ file });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to update file";
    if (msg === "FILE_NOT_FOUND") {
      return error("NOT_FOUND", "File not found", 404);
    }
    if (msg === "FORBIDDEN_FILE_UPDATE") {
      return error("FORBIDDEN", "Forbidden - unauthorized to update file", 403);
    }
    return error("FILE_UPDATE_FAILED", msg, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const resolvedParams = await context.params;
    const fileId = resolvedParams.id;

    const file = await fileService.deleteFile(user, fileId);
    return success({ file });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to delete file";
    if (msg === "FILE_NOT_FOUND") {
      return error("NOT_FOUND", "File not found", 404);
    }
    if (msg === "FORBIDDEN_FILE_DELETE") {
      return error("FORBIDDEN", "Forbidden - unauthorized to delete file", 403);
    }
    return error("FILE_DELETE_FAILED", msg, 500);
  }
}
