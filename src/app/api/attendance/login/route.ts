import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { loginAttendance } from "../../../../services/attendanceService";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json().catch(() => ({}));
    const deviceType = body?.deviceType || "WEB";
    const result = await loginAttendance(String(user._id), deviceType);
    return success({ attendance: result.attendance, session: result.session, user: result.user });
  } catch (err: unknown) {
    if (err && typeof err === "object" && ((err as any).code === "PASSWORD_CHANGE_REQUIRED" || (err as any).name === "PasswordChangeRequiredError")) {
      return error("PASSWORD_CHANGE_REQUIRED", (err as any).message || "Mandatory password change required", 403);
    }
    const message = err instanceof Error ? err.message : "Unable to login";
    if (message === "USER_INACTIVE") return error("USER_INACTIVE", "User is inactive", 403);
    if (message === "ACTIVE_SESSION_EXISTS") return error("ACTIVE_SESSION_EXISTS", "Another active session already exists", 409);
    if (message === "ACTIVE_BREAK_EXISTS") return error("ACTIVE_BREAK_EXISTS", "A break is already active", 409);
    if (message === "USER_NOT_FOUND") return error("USER_NOT_FOUND", "User not found", 404);
    return error("LOGIN_FAILED", message, 500);
  }
}
