import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as announcementService from "../../../services/announcementService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    const status = url.searchParams.get("status") || undefined;
    const audienceType = url.searchParams.get("audienceType") || undefined;

    const result = await announcementService.listAnnouncements(user, {
      skip: (page - 1) * limit,
      limit,
      status,
      audienceType,
    });
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load announcements";
    return error("ANNOUNCEMENT_LIST_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    // Only Admin and Super Admin are permitted to create/manage announcements
    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return error("FORBIDDEN", "Only administrators can create announcements", 403);
    }

    const body = await request.json();
    if (!body.title || !body.message) {
      return error("VALIDATION_ERROR", "Title and message are required", 422);
    }

    const announcement = await announcementService.createAnnouncement(user, body);
    return success({ announcement });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to create announcement";
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Forbidden", 403);
    }
    return error("ANNOUNCEMENT_CREATE_FAILED", message, 500);
  }
}
