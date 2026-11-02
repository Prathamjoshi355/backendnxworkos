import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getTodayAttendanceForUser } from "../../../../services/attendanceService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const result = await getTodayAttendanceForUser(String(user._id));
    return success({
      attendance: result?.attendance || null,
      activeSession: result?.activeSession || null,
      activeBreak: result?.activeBreak || null,
      workDurationText: result?.workDurationText || "0m",
      breakDurationText: result?.breakDurationText || "0m",
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && ((err as any).code === "PASSWORD_CHANGE_REQUIRED" || (err as any).name === "PasswordChangeRequiredError")) {
      return error("PASSWORD_CHANGE_REQUIRED", (err as any).message || "Mandatory password change required", 403);
    }
    const message = err instanceof Error ? err.message : "Unable to fetch today's attendance";
    return error("TODAY_ATTENDANCE_FAILED", message, 500);
  }
}
