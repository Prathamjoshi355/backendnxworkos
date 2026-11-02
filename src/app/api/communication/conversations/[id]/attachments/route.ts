import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as communicationService from "../../../../../../services/communicationService";
import { success, error, handleApiError } from "../../../../../../utils/response";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const contentType = request.headers.get("content-type") || "";
    let fileBuffer: Buffer;
    let fileName: string;
    let mimeType: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return error("BAD_REQUEST", "No file found in multipart form-data", 400);
      }
      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      fileName = file.name;
      mimeType = file.type || "application/octet-stream";
    } else {
      const body = await request.json();
      if (!body.base64 || !body.fileName) {
        return error("BAD_REQUEST", "fileName and base64 string are required", 400);
      }
      fileBuffer = Buffer.from(body.base64, "base64");
      fileName = body.fileName;
      mimeType = body.mimeType || "application/octet-stream";
    }

    const attachment = await communicationService.uploadConversationAttachment(user, id, {
      buffer: fileBuffer,
      fileName,
      mimeType,
    });

    return success({ attachment }, 201);
  } catch (err: any) {
    if (err.message?.includes("INVALID_FILE") || err.message?.includes("MAX_SIZE_EXCEEDED")) {
      return error("INVALID_FILE", err.message, 422);
    }
    if (err.message === "FORBIDDEN") {
      return error("FORBIDDEN", "You are not authorized to upload attachments in this conversation", 403);
    }
    return handleApiError(err, "ATTACHMENT_UPLOAD_FAILED", err.message || "Failed to upload attachment");
  }
}

