import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { logoutAttendance } from "../../../../services/attendanceService";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const result = await logoutAttendance(String(user._id));
    return success({ attendance: result.attendance, session: result.session, user: result.user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to logout";
    if (message === "NO_ACTIVE_SESSION") return error("NO_ACTIVE_SESSION", "No active work session to logout", 409);
    if (message === "EOD_REPORT_REQUIRED") return error("EOD_REPORT_REQUIRED", "Daily EOD report must be submitted before logging out", 400);
    if (message === "ACTIVE_BREAK_EXISTS") return error("ACTIVE_BREAK_EXISTS", "Close active break before logging out", 409);
    if (message === "ATTENDANCE_NOT_FOUND") return error("ATTENDANCE_NOT_FOUND", "Attendance record not found", 404);
    if (message === "USER_NOT_FOUND") return error("USER_NOT_FOUND", "User not found", 404);
    if (message === "ALREADY_LOGGED_OUT") return error("ALREADY_LOGGED_OUT", "User is already logged out", 409);
    return error("LOGOUT_FAILED", message, 500);
  }
}
