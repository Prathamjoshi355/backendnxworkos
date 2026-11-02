import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as communicationService from "../../../../../../services/communicationService";
import { success, error } from "../../../../../../utils/response";

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

    const result = await communicationService.markConversationRead(
      user,
      id
    );
    return success(result);
  } catch (err: any) {
    console.error(`POST /api/communication/conversations/${id}/read error:`, err);
    const statusCode = err.message === "FORBIDDEN"
      ? 403
      : err.message === "CONVERSATION_NOT_FOUND"
      ? 404
      : 500;
    return error("FAILED", err.message || "Failed to mark read", statusCode);
  }
}
