import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { startBreak } from "../../../../../services/attendanceService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json().catch(() => ({}));
    const type = body?.type || "LUNCH";
    const result = await startBreak(String(user._id), type);
    return success({ attendance: result.attendance, break: result.break, user: result.user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to start break";
    if (message === "NO_ACTIVE_SESSION") return error("NO_ACTIVE_SESSION", "No active work session", 409);
    if (message === "ACTIVE_BREAK_EXISTS") return error("ACTIVE_BREAK_EXISTS", "A break is already active", 409);
    if (message === "ATTENDANCE_NOT_FOUND") return error("ATTENDANCE_NOT_FOUND", "Attendance record not found", 404);
    return error("BREAK_START_FAILED", message, 500);
  }
}
