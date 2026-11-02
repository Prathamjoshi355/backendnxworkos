import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as meetingService from "../../../../../../services/meetingService";
import { success, error } from "../../../../../../utils/response";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; participantId: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id, participantId } = await context.params;
    const updated = await meetingService.removeMeetingParticipant(id, participantId, user);
    return success({ meeting: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to remove participant";
    if (message === "FORBIDDEN") return error("FORBIDDEN", "Forbidden", 403);
    if (message === "MEETING_NOT_FOUND") return error("NOT_FOUND", "Meeting not found", 404);
    return error("MEETING_PARTICIPANT_REMOVE_FAILED", message, 500);
  }
}
