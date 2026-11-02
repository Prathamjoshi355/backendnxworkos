import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as communicationService from "../../../../../../services/communicationService";
import { success, error } from "../../../../../../utils/response";

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

    const url = new URL(request.url);
    const before = url.searchParams.get("before") || undefined;
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const result = await communicationService.listMessages(user, id, {
      before,
      page,
      limit,
    });

    return success(result);
  } catch (err: any) {
    console.error(`GET /api/communication/conversations/${id}/messages error:`, err);
    const statusCode = err.message === "FORBIDDEN"
      ? 403
      : err.message === "CONVERSATION_NOT_FOUND"
      ? 404
      : 500;
    return error("FAILED", err.message || "Failed to list messages", statusCode);
  }
}

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

    const body = await request.json();
    if (!body.body || !body.body.trim()) {
      return error("BAD_REQUEST", "body is required", 400);
    }

    const message = await communicationService.sendMessage(user, id, {
      body: body.body,
      clientMessageId: body.clientMessageId,
      messageType: body.messageType,
      attachments: body.attachments,
      replyTo: body.replyTo,
    });

    return success({ message }, 201);
  } catch (err: any) {
    console.error(`POST /api/communication/conversations/${id}/messages error:`, err);
    const statusCode = err.message.includes("REQUIRED")
      ? 400
      : err.message === "FORBIDDEN"
      ? 403
      : err.message === "CONVERSATION_NOT_FOUND"
      ? 404
      : 500;
    return error("FAILED", err.message || "Failed to send message", statusCode);
  }
}
