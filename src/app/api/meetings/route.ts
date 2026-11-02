import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as meetingService from "../../../services/meetingService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");
    const status = url.searchParams.get("status") || undefined;
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const teamId = url.searchParams.get("teamId") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (departmentId) filter.departmentId = departmentId;
    if (teamId) filter.teamId = teamId;

    const result = await meetingService.listMeetings(user, filter, {
      skip: (page - 1) * limit,
      limit,
      startDate,
      endDate,
    });
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load meetings";
    return error("MEETING_LIST_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    if (!body.title || !body.date || !body.startTime || !body.endTime) {
      return error("VALIDATION_ERROR", "Title, date, start time, and end time are required", 422);
    }

    const meeting = await meetingService.scheduleMeeting(user, body);
    return success({ meeting });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to schedule meeting";
    return error("MEETING_SCHEDULE_FAILED", message, 500);
  }
}
