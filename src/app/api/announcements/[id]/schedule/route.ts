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
      return error("FORBIDDEN", "Only administrators can schedule announcements", 403);
    }

    const id = await getId(context);
    const body = await request.json();
    if (!body.publishAt) {
      return error("VALIDATION_ERROR", "publishAt date is required for scheduling", 422);
    }

    const announcement = await announcementService.scheduleAnnouncement(user, id, body.publishAt);
    return success({ announcement });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to schedule announcement";
    if (message === "ANNOUNCEMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Announcement not found", 404);
    }
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Forbidden", 403);
    }
    if (message === "INVALID_SCHEDULE_DATE") {
      return error("VALIDATION_ERROR", "Invalid schedule date", 422);
    }
    return error("ANNOUNCEMENT_SCHEDULE_FAILED", message, 500);
  }
}
