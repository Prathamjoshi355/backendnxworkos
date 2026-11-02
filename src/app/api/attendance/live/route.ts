import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getLiveAttendance } from "../../../../services/attendanceService";
import { getManagementScope } from "../../../../utils/scopeHelper";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const teamParam = url.searchParams.get("teamId");

    let items;
    const isHrAuthorized = user.role === "HR" || (Array.isArray(user.permissions) && (user.permissions.includes("attendance.view") || user.permissions.includes("hr.manage")));

    if (user.role === "SUPER_ADMIN") {
      const orgParam = url.searchParams.get("organizationId");
      items = await getLiveAttendance({
        organizationId: orgParam || null,
        teamIds: teamParam ? [teamParam] : undefined,
      });
    } else if (user.role === "ADMIN" || isHrAuthorized) {
      // Organization-wide visibility derived strictly from server identity
      items = await getLiveAttendance({
        organizationId: String(user.organizationId),
        teamIds: teamParam ? [teamParam] : undefined,
      });
    } else if (user.role === "DIVISION_ADMIN") {
      // Scoped strictly to explicitly assigned active division
      const divId = user.divisionId ? String(user.divisionId) : null;
      if (!divId) {
        return error("FORBIDDEN", "Division administrator has no assigned division.", 403);
      }
      items = await getLiveAttendance({
        organizationId: String(user.organizationId),
        divisionId: divId,
        teamIds: teamParam ? [teamParam] : undefined,
      });
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      const scope = await getManagementScope(user);
      if (teamParam && !scope.managedTeamIds.includes(teamParam)) {
        return error("FORBIDDEN", "Selected team is outside your management scope", 403);
      }
      items = await getLiveAttendance({
        userIds: scope.scopedUserIds,
        organizationId: String(user.organizationId),
        teamIds: teamParam ? [teamParam] : scope.managedTeamIds,
      });
    } else {
      // EMPLOYEE / INTERN: Only their own attendance
      items = await getLiveAttendance({
        userIds: [String(user._id)],
        organizationId: String(user.organizationId || ""),
      });
    }

    return success({ items });
  } catch (err: unknown) {
    if (err && typeof err === "object" && ((err as any).code === "PASSWORD_CHANGE_REQUIRED" || (err as any).name === "PasswordChangeRequiredError")) {
      return error("PASSWORD_CHANGE_REQUIRED", (err as any).message || "Mandatory password change required", 403);
    }
    const message = err instanceof Error ? err.message : "Unable to load live attendance";
    return error("LIVE_ATTENDANCE_FAILED", message, 500);
  }
}
