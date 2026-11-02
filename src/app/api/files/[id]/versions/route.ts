import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as fileService from "../../../../../services/fileService";
import { success, error } from "../../../../../utils/response";

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
    return success({
      currentVersion: file.version,
      versions: file.versions,
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to retrieve file versions";
    if (msg === "FILE_NOT_FOUND") {
      return error("NOT_FOUND", "File not found", 404);
    }
    if (msg === "FORBIDDEN_FILE_ACCESS") {
      return error("FORBIDDEN", "Forbidden", 403);
    }
    return error("VERSIONS_GET_FAILED", msg, 500);
  }
}

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

    const contentType = request.headers.get("content-type") || "";
    let buffer: Buffer;
    let fileName: string | undefined;
    let mimeType: string | undefined;
    let note: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const fileEntry = formData.get("file");
      if (!fileEntry || !(fileEntry instanceof Blob)) {
        return error("VALIDATION_ERROR", "File is required in form-data ('file')", 422);
      }
      const arrayBuffer = await fileEntry.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      fileName = (fileEntry as any).name;
      mimeType = fileEntry.type;
      note = (formData.get("note") as string) || undefined;
    } else {
      const body = await request.json();
      if (!body.buffer && !body.fileData && !body.fileBuffer) {
        return error("VALIDATION_ERROR", "File content (buffer or fileData) is required", 422);
      }
      buffer = body.buffer || body.fileData || body.fileBuffer;
      fileName = body.fileName || body.name;
      mimeType = body.mimeType;
      note = body.note;
    }

    const file = await fileService.createFileVersion(user, fileId, {
      buffer,
      fileName,
      mimeType,
      note,
    });

    return success({ file }, 201);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to upload new version";
    if (msg === "FILE_NOT_FOUND") {
      return error("NOT_FOUND", "File not found", 404);
    }
    if (msg === "FORBIDDEN_FILE_VERSION") {
      return error("FORBIDDEN", "Forbidden - unauthorized to upload version", 403);
    }
    if (msg.includes("FILE_TOO_LARGE") || msg.includes("BLOCKED_FILE_EXTENSION") || msg.includes("MIME_EXTENSION_MISMATCH")) {
      return error("INVALID_FILE_UPLOAD", msg, 400);
    }
    return error("VERSION_UPLOAD_FAILED", msg, 500);
  }
}
