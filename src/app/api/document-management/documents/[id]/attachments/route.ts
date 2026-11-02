import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import { success, error } from "../../../../../../utils/response";
import * as docService from "../../../../../../services/documentManagementService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await params;
    const doc = await docService.getDocumentById(user, id);
    return success({ attachments: doc.attachments, total: doc.attachments.length });
  } catch (err: any) {
    if (err.message === "DOCUMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Document not found", 404);
    }
    return error("FAILED", err.message, 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";

    let fileBuffer: Buffer;
    let fileName: string;
    let mimeType: string;
    let attachmentType: any = "ORIGINAL";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File;
      if (!file) {
        return error("VALIDATION_ERROR", "No file provided in form data", 422);
      }
      fileName = file.name;
      mimeType = file.type || "application/octet-stream";
      attachmentType = formData.get("attachmentType") || "ORIGINAL";
      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
    } else {
      const body = await request.json();
      if (!body.fileName || !body.base64) {
        return error("VALIDATION_ERROR", "fileName and base64 fields are required", 422);
      }
      fileName = body.fileName;
      mimeType = body.mimeType || "application/octet-stream";
      attachmentType = body.attachmentType || "ORIGINAL";
      fileBuffer = Buffer.from(body.base64, "base64");
    }

    const attachment = await docService.uploadDocumentAttachment(user, id, {
      buffer: fileBuffer,
      fileName,
      mimeType,
      attachmentType,
    });

    return success({ attachment }, 201);
  } catch (err: any) {
    if (err.message === "DOCUMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Document not found", 404);
    }
    if (err.message.startsWith("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    return error("FAILED", err.message, 500);
  }
}
