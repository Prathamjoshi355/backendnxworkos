import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as communicationService from "../../../../services/communicationService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const result = await communicationService.listConversations(user, {
      type,
      search,
      page,
      limit,
    });

    return success(result);
  } catch (err: any) {
    console.error("GET /api/communication/conversations error:", err);
    return error("FAILED", err.message || "Failed to list conversations", 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const body = await request.json();
    const type = body.type || (body.recipientId ? "DIRECT" : "GROUP");

    if (type === "DIRECT") {
      if (!body.recipientId) {
        return error("BAD_REQUEST", "recipientId is required for direct conversation", 400);
      }
      const conversation = await communicationService.getOrCreateDirectConversation(
        user,
        body.recipientId
      );
      return success({ conversation }, 201);
    } else {
      if (!body.name || !body.name.trim()) {
        return error("BAD_REQUEST", "name is required for group conversation", 400);
      }
      const conversation = await communicationService.createGroupConversation(
        user,
        {
          name: body.name,
          participantIds: body.participantIds || body.participants || [],
          projectId: body.projectId,
          meetingId: body.meetingId,
        }
      );
      return success({ conversation }, 201);
    }
  } catch (err: any) {
    console.error("POST /api/communication/conversations error:", err);
    const statusCode = err.message.includes("REQUIRED") || err.message.includes("INVALID")
      ? 400
      : err.message.includes("FORBIDDEN")
      ? 403
      : err.message.includes("NOT_FOUND")
      ? 404
      : 500;
    return error("FAILED", err.message || "Failed to create conversation", statusCode);
  }
}
