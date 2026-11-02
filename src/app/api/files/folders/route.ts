import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as fileService from "../../../../services/fileService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const parentFolderId = url.searchParams.get("parentFolderId") ?? undefined;
    const category = url.searchParams.get("category") || undefined;
    const organizationId = url.searchParams.get("organizationId") || undefined;

    const folders = await fileService.listFolders(user, {
      parentFolderId,
      category,
      organizationId,
    });

    return success({ folders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to list folders";
    return error("FOLDER_LIST_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    if (!body.name || body.name.trim().length === 0) {
      return error("VALIDATION_ERROR", "Folder name is required", 422);
    }

    const folder = await fileService.createFolder(user, {
      name: body.name,
      parentFolderId: body.parentFolderId,
      category: body.category,
      organizationId: body.organizationId,
    });

    return success({ folder }, 201);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to create folder";
    if (msg === "PARENT_FOLDER_NOT_FOUND") {
      return error("NOT_FOUND", "Parent folder not found", 404);
    }
    return error("FOLDER_CREATE_FAILED", msg, 500);
  }
}
