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

    const result = await communicationService.markMessagesDelivered(user, id);
    return success(result);
  } catch (err: unknown) {
    return handleApiError(err, "DELIVERY_ACK_FAILED", "Failed to acknowledge delivery");
  }
}

