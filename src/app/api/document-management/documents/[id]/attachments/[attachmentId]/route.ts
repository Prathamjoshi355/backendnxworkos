import { connectToDatabase } from "../../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../../middleware/auth";
import { success, error } from "../../../../../../../utils/response";
import * as docService from "../../../../../../../services/documentManagementService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id, attachmentId } = await params;
    const result = await docService.getDocumentAttachmentSignedUrl(
      user,
      id,
      attachmentId
    );

    return success({
      url: result.signedUrl,
      attachment: result.attachment,
      expiresInSeconds: 900,
    });
  } catch (err: any) {
    if (err.message === "ATTACHMENT_NOT_FOUND" || err.message === "DOCUMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Attachment or Document not found", 404);
    }
    if (err.message.startsWith("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    return error("FAILED", err.message, 500);
  }
}
