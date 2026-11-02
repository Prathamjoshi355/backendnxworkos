import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as communicationService from "../../../../../../services/communicationService";
import { success, error, handleApiError } from "../../../../../../utils/response";

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
    const participantIds = body.participantIds || (body.participantId ? [body.participantId] : []);
    if (!participantIds.length) {
      return error("BAD_REQUEST", "participantIds is required", 400);
    }

    const updated = await communicationService.addParticipantsToGroup(user, id, participantIds);
    return success({ conversation: updated });
  } catch (err: any) {
    if (err.message.includes("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    return handleApiError(err, "ADD_PARTICIPANTS_FAILED", err.message || "Failed to add participants");
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

    const url = new URL(request.url);
    const participantId = url.searchParams.get("participantId");
    const isSelfLeave = !participantId || participantId === String(user._id);

    if (isSelfLeave) {
      const result = await communicationService.leaveGroup(user, id);
      return success(result);
    } else {
      const updated = await communicationService.removeParticipantFromGroup(user, id, participantId);
      return success({ conversation: updated });
    }
  } catch (err: any) {
    if (err.message.includes("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    return handleApiError(err, "REMOVE_PARTICIPANT_FAILED", err.message || "Failed to remove participant");
  }
}

