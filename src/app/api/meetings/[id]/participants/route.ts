import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as meetingService from "../../../../../services/meetingService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    const participantIds = Array.isArray(body.participantIds)
      ? body.participantIds
      : body.participantId
      ? [body.participantId]
      : [];
    if (participantIds.length === 0) return error("VALIDATION_ERROR", "participantIds required", 422);

    const updated = await meetingService.addMeetingParticipants((await context.params).id, participantIds, user);
    return success({ meeting: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to add participants";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "MEETING_NOT_FOUND") return error("NOT_FOUND", "Meeting not found", 404);
    return error("MEETING_PARTICIPANTS_ADD_FAILED", message, 500);
  }
}
