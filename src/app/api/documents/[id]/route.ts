import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as documentService from "../../../../services/documentService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const doc = await documentService.getDocumentById(id, user);
    return success({ document: doc });
  } catch (err: any) {
    if (err.message === "FORBIDDEN" || err.message === "FORBIDDEN_ORGANIZATION_ACCESS") {
      return error("FORBIDDEN", "Forbidden", 403);
    }
    if (err.message === "DOCUMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Document not found", 404);
    }
    const message = err instanceof Error ? err.message : "Unable to retrieve document";
    return error("DOCUMENT_GET_FAILED", message, 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const doc = await documentService.deleteDocument(id, user);
    return success({ document: doc });
  } catch (err: any) {
    if (err.message === "UNAUTHORIZED_DOCUMENT_DELETE") {
      return error("FORBIDDEN", "You are not authorized to delete this document", 403);
    }
    if (err.message === "DOCUMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Document not found", 404);
    }
    const message = err instanceof Error ? err.message : "Unable to delete document";
    return error("DOCUMENT_DELETE_FAILED", message, 500);
  }
}
