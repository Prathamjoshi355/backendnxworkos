import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as announcementService from "../../../../services/announcementService";
import { success, error } from "../../../../utils/response";

async function getId(context: any): Promise<string> {
  const p = await (context?.params || {});
  return p.id;
}

export async function GET(request: Request, context: any) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const id = await getId(context);
    const announcement = await announcementService.getAnnouncementById(user, id);
    return success({ announcement });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to get announcement";
    if (message === "ANNOUNCEMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Announcement not found", 404);
    }
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Forbidden - access denied to this announcement", 403);
    }
    return error("ANNOUNCEMENT_GET_FAILED", message, 500);
  }
}

export async function PATCH(request: Request, context: any) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return error("FORBIDDEN", "Only administrators can edit announcements", 403);
    }

    const id = await getId(context);
    const body = await request.json();
    const announcement = await announcementService.updateAnnouncement(user, id, body);
    return success({ announcement });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to update announcement";
    if (message === "ANNOUNCEMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Announcement not found", 404);
    }
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Forbidden", 403);
    }
    return error("ANNOUNCEMENT_UPDATE_FAILED", message, 500);
  }
}

export async function DELETE(request: Request, context: any) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return error("FORBIDDEN", "Only administrators can delete announcements", 403);
    }

    const id = await getId(context);
    await announcementService.deleteAnnouncement(user, id);
    return success({ deleted: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to delete announcement";
    if (message === "ANNOUNCEMENT_NOT_FOUND") {
      return error("NOT_FOUND", "Announcement not found", 404);
    }
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Forbidden", 403);
    }
    return error("ANNOUNCEMENT_DELETE_FAILED", message, 500);
  }
}
