import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as announcementService from "../../../../../services/announcementService";
import { success, error } from "../../../../../utils/response";

async function getId(context: any): Promise<string> {
  const p = await (context?.params || {});
  return p.id;
}

export async function POST(request: Request, context: any) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const id = await getId(context);
    const announcement = await announcementService.markAnnouncementRead(id, String(user._id || user.id), user);
    return success({ announcement });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to mark announcement read";
    if (message === "ANNOUNCEMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Announcement not found", 404);
    }
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Forbidden - cannot mark inaccessible announcement as read", 403);
    }
    return error("ANNOUNCEMENT_READ_FAILED", message, 500);
  }
}
