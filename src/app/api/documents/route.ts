import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as documentService from "../../../services/documentService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || undefined;
    const documentType = url.searchParams.get("documentType") || undefined;
    const status = url.searchParams.get("status") || undefined;

    const filters: any = {};
    if (documentType) filters.documentType = documentType;
    if (status) filters.status = status;

    const items = await documentService.listDocuments(user, userId, filters);
    return success({ items, total: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load documents";
    return error("DOCUMENT_LIST_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const contentType = request.headers.get("content-type") || "";
    let payload: any = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File;
      if (!file) {
        return error("VALIDATION_ERROR", "No file uploaded in form data", 422);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      payload = {
        title: formData.get("title") || file.name,
        documentType: formData.get("documentType") || "OTHER",
        userId: formData.get("userId") || undefined,
        fileName: file.name,
        mimeType: file.type || "application/pdf",
        fileBuffer: buffer,
        fileSize: buffer.length,
      };
    } else {
      payload = await request.json();
    }

    if (!payload.title || (!payload.fileName && !payload.fileUrl && !payload.fileData && !payload.fileBuffer)) {
      return error("VALIDATION_ERROR", "Title and file details are required", 422);
    }

    const doc = await documentService.createDocument(user, payload);
    return success({ document: doc }, 201);
  } catch (err: any) {
    if (err.message?.startsWith("INVALID_PDF_FORMAT")) {
      return error("VALIDATION_ERROR", err.message, 422);
    }
    if (err.message === "UNAUTHORIZED_DOCUMENT_UPLOAD") {
      return error("FORBIDDEN", "You are not authorized to upload documents for this user", 403);
    }
    if (err.message === "FORBIDDEN_ORGANIZATION_ACCESS") {
      return error("FORBIDDEN", "Forbidden - user belongs to another organization", 403);
    }
    if (err.message === "USER_NOT_FOUND") {
      return error("NOT_FOUND", "Target user not found", 404);
    }
    const message = err instanceof Error ? err.message : "Unable to upload document";
    return error("DOCUMENT_UPLOAD_FAILED", message, 500);
  }
}
