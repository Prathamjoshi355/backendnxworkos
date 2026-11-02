import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as meetingService from "../../../../services/meetingService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const meeting = await meetingService.getMeetingById(id, user);
    return success({ meeting });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to get meeting";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "MEETING_NOT_FOUND") return error("NOT_FOUND", "Meeting not found", 404);
    return error("MEETING_GET_FAILED", message, 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const body = await request.json();
    if (body.responseStatus) {
      const updated = await meetingService.updateParticipantResponse(id, String(user._id || user.id), body.responseStatus);
      return success({ meeting: updated });
    }

    const updated = await meetingService.updateMeeting(id, user, body);
    return success({ meeting: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to update meeting";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "MEETING_NOT_FOUND") return error("NOT_FOUND", "Meeting not found", 404);
    if (message === "CANNOT_MODIFY_CANCELLED_MEETING") return error("CONFLICT", "Cannot modify cancelled meeting", 409);
    return error("MEETING_UPDATE_FAILED", message, 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    let reason: string | undefined;
    try {
      const body = await request.json();
      reason = body?.reason;
    } catch (_) {}

    const cancelled = await meetingService.cancelMeeting(id, user, reason);
    return success({ meeting: cancelled });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to cancel meeting";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "MEETING_NOT_FOUND") return error("NOT_FOUND", "Meeting not found", 404);
    return error("MEETING_CANCEL_FAILED", message, 500);
  }
}
