import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as communicationService from "../../../../../services/communicationService";
import { success, error } from "../../../../../utils/response";

export async function GET(
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

    const conversation = await communicationService.getConversationById(
      user,
      id
    );
    return success({ conversation });
  } catch (err: any) {
    console.error(`GET /api/communication/conversations/${id} error:`, err);
    const statusCode = err.message === "FORBIDDEN"
      ? 403
      : err.message === "CONVERSATION_NOT_FOUND"
      ? 404
      : 500;
    return error("FAILED", err.message || "Failed to fetch conversation", statusCode);
  }
}

export async function PUT(
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

    const body = await request.json();
    const updated = await communicationService.updateGroupDetails(user, id, {
      name: body.name,
      description: body.description,
      groupImage: body.groupImage,
    });

    return success({ conversation: updated });
  } catch (err: any) {
    const statusCode = err.message.includes("FORBIDDEN")
      ? 403
      : err.message.includes("NOT_FOUND")
      ? 404
      : 400;
    return error("GROUP_UPDATE_FAILED", err.message || "Failed to update group details", statusCode);
  }
}
