import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as fileService from "../../../services/fileService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const params = {
      page: Number(url.searchParams.get("page")) || 1,
      limit: Number(url.searchParams.get("limit")) || 20,
      search: url.searchParams.get("search") || undefined,
      category: url.searchParams.get("category") || undefined,
      status: url.searchParams.get("status") || undefined,
      parentFolderId: url.searchParams.get("parentFolderId") ?? undefined,
      projectId: url.searchParams.get("projectId") || undefined,
      taskId: url.searchParams.get("taskId") || undefined,
      meetingId: url.searchParams.get("meetingId") || undefined,
      employeeId: url.searchParams.get("employeeId") || undefined,
      visibility: url.searchParams.get("visibility") || undefined,
      organizationId: url.searchParams.get("organizationId") || undefined,
    };

    const result = await fileService.listFiles(user, params);
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to list files";
    return error("FILE_LIST_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const contentType = request.headers.get("content-type") || "";

    let buffer: Buffer;
    let fileName: string = "";
    let mimeType: string | undefined;
    let category: string | undefined;
    let description: string | undefined;
    let tags: string[] | string | undefined;
    let parentFolderId: string | null | undefined;
    let visibility: string | undefined;
    let projectId: string | undefined;
    let taskId: string | undefined;
    let meetingId: string | undefined;
    let employeeId: string | undefined;
    let organizationId: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const fileEntry = formData.get("file");
      if (!fileEntry || !(fileEntry instanceof Blob)) {
        return error("VALIDATION_ERROR", "File is required in form-data ('file')", 422);
      }
      const arrayBuffer = await fileEntry.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      fileName = (fileEntry as any).name || "uploaded_file";
      mimeType = fileEntry.type;

      category = (formData.get("category") as string) || undefined;
      description = (formData.get("description") as string) || undefined;
      tags = (formData.get("tags") as string) || undefined;
      parentFolderId = (formData.get("parentFolderId") as string) || undefined;
      visibility = (formData.get("visibility") as string) || undefined;
      projectId = (formData.get("projectId") as string) || undefined;
      taskId = (formData.get("taskId") as string) || undefined;
      meetingId = (formData.get("meetingId") as string) || undefined;
      employeeId = (formData.get("employeeId") as string) || undefined;
      organizationId = (formData.get("organizationId") as string) || undefined;
    } else {
      const body = await request.json();
      if (!body.buffer && !body.fileData && !body.fileBuffer) {
        return error("VALIDATION_ERROR", "File content (buffer or fileData) is required", 422);
      }
      buffer = body.buffer || body.fileData || body.fileBuffer;
      fileName = body.fileName || body.name || "uploaded_file";
      mimeType = body.mimeType;
      category = body.category;
      description = body.description;
      tags = body.tags;
      parentFolderId = body.parentFolderId;
      visibility = body.visibility;
      projectId = body.projectId;
      taskId = body.taskId;
      meetingId = body.meetingId;
      employeeId = body.employeeId;
      organizationId = body.organizationId;
    }

    const fileRecord = await fileService.uploadFile(user, {
      buffer,
      fileName,
      mimeType,
      category,
      description,
      tags,
      parentFolderId,
      visibility,
      projectId,
      taskId,
      meetingId,
      employeeId,
      organizationId,
    });

    return success({ file: fileRecord }, 201);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "File upload failed";
    if (msg.includes("FILE_TOO_LARGE") || msg.includes("BLOCKED_FILE_EXTENSION") || msg.includes("FILE_EMPTY") || msg.includes("MIME_EXTENSION_MISMATCH")) {
      return error("INVALID_FILE_UPLOAD", msg, 400);
    }
    if (msg === "FOLDER_NOT_FOUND") {
      return error("NOT_FOUND", "Target folder not found", 404);
    }
    return error("UPLOAD_FAILED", msg, 500);
  }
}
