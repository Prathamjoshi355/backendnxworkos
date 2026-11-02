import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import * as documentService from "../../../../../services/documentService";
import { success, error } from "../../../../../utils/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "HR"])) {
      return error("FORBIDDEN", "Only Super Admin, Admin, or HR can verify or reject documents", 403);
    }

    const { id } = await context.params;
    const body = await request.json();

    if (typeof body.isApproved !== "boolean") {
      return error("VALIDATION_ERROR", "isApproved (boolean) is required", 422);
    }

    const doc = await documentService.verifyDocument(id, user, {
      isApproved: body.isApproved,
      rejectionReason: body.rejectionReason,
    });

    return success({ document: doc });
  } catch (err: any) {
    if (err.message === "UNAUTHORIZED_DOCUMENT_VERIFICATION") {
      return error("FORBIDDEN", "Unauthorized document verification", 403);
    }
    if (err.message === "FORBIDDEN_ORGANIZATION_ACCESS") {
      return error("FORBIDDEN", "Forbidden - document belongs to another organization", 403);
    }
    if (err.message === "DOCUMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Document not found", 404);
    }
    const message = err instanceof Error ? err.message : "Unable to verify document";
    return error("DOCUMENT_VERIFY_FAILED", message, 500);
  }
}
