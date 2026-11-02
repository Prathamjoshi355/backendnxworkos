import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { endBreak } from "../../../../../services/attendanceService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const result = await endBreak(String(user._id));
    return success({ attendance: result.attendance, break: result.break, user: result.user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to end break";
    if (message === "NO_ACTIVE_BREAK") return error("NO_ACTIVE_BREAK", "No active break to end", 409);
    if (message === "ATTENDANCE_NOT_FOUND") return error("ATTENDANCE_NOT_FOUND", "Attendance record not found", 404);
    return error("BREAK_END_FAILED", message, 500);
  }
}
