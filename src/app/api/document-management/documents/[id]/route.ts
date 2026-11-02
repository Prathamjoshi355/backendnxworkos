import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { success, error } from "../../../../../utils/response";
import * as docService from "../../../../../services/documentManagementService";

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
    return success({ document: doc });
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await params;
    const body = await request.json();
    if (!body.status) {
      return error("VALIDATION_ERROR", "New status is required", 422);
    }

    const doc = await docService.updateDocumentStatus(user, id, body.status, body.notes);
    return success({ document: doc });
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await params;
    const body = await request.json();

    const doc = await docService.updateDocumentMetadata(user, id, body);
    return success({ document: doc });
  } catch (err: any) {
    if (err.message === "DOCUMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Document not found", 404);
    }
    if (err.message.startsWith("IMMUTABLE_DOCUMENT_ID") || err.message.startsWith("CLIENT_OVERRIDE_PROHIBITED")) {
      return error("IMMUTABLE_VIOLATION", err.message, 422);
    }
    if (err.message.startsWith("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    return error("FAILED", err.message, 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await params;
    const url = new URL(request.url);
    const reason = url.searchParams.get("reason") || undefined;

    const doc = await docService.archiveDocument(user, id, reason);
    return success({ document: doc, message: "Document archived successfully" });
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
