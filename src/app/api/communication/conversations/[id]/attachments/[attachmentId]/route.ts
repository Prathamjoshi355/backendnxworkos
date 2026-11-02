import { connectToDatabase } from "../../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../../middleware/auth";
import * as communicationService from "../../../../../../../services/communicationService";
import { success, error, handleApiError } from "../../../../../../../utils/response";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await context.params;
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const result = await communicationService.getAttachmentAccess(user, id, attachmentId);

    return success({
      attachment: result.attachment,
      signedUrl: result.signedUrl,
    });
  } catch (err: any) {
    if (err.message === "FORBIDDEN") {
      return error("FORBIDDEN", "You are not authorized to access attachments in this conversation", 403);
    }
    if (err.message === "ATTACHMENT_NOT_FOUND" || err.message === "CONVERSATION_NOT_FOUND") {
      return error("NOT_FOUND", "Attachment not found", 404);
    }
    return handleApiError(err, "ATTACHMENT_ACCESS_FAILED", err.message || "Failed to access attachment");
  }
}

