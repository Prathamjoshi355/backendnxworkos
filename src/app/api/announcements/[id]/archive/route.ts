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

    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return error("FORBIDDEN", "Only administrators can archive announcements", 403);
    }

    const id = await getId(context);
    const announcement = await announcementService.archiveAnnouncement(user, id);
    return success({ announcement });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to archive announcement";
    if (message === "ANNOUNCEMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Announcement not found", 404);
    }
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Forbidden", 403);
    }
    return error("ANNOUNCEMENT_ARCHIVE_FAILED", message, 500);
  }
}
