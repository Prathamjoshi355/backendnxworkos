import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as communicationService from "../../../../../services/communicationService";
import { success, error } from "../../../../../utils/response";

export async function PATCH(
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
    if (!body.body || !body.body.trim()) {
      return error("BAD_REQUEST", "body is required", 400);
    }

    const message = await communicationService.editMessage(
      user,
      id,
      body.body
    );
    return success({ message });
  } catch (err: any) {
    console.error(`PATCH /api/communication/messages/${id} error:`, err);
    const statusCode = err.message.includes("REQUIRED")
      ? 400
      : err.message === "FORBIDDEN"
      ? 403
      : err.message === "MESSAGE_NOT_FOUND"
      ? 404
      : 500;
    return error("FAILED", err.message || "Failed to edit message", statusCode);
  }
}

export async function DELETE(
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

    const result = await communicationService.deleteMessage(user, id);
    return success(result);
  } catch (err: any) {
    console.error(`DELETE /api/communication/messages/${id} error:`, err);
    const statusCode = err.message === "FORBIDDEN"
      ? 403
      : err.message === "MESSAGE_NOT_FOUND"
      ? 404
      : 500;
    return error("FAILED", err.message || "Failed to delete message", statusCode);
  }
}
