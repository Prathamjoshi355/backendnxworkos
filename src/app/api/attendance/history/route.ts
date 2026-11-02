import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import { AttendanceFilterSchema } from "../../../../validators/attendance";
import Attendance from "../../../../models/Attendance";
import User from "../../../../models/User";
import { getManagementScope } from "../../../../utils/scopeHelper";

async function buildHistoryQuery(authUser: any, filters: any) {
  const query: any = {};
  const isHrAuthorized = authUser.role === "HR" || (Array.isArray(authUser.permissions) && (authUser.permissions.includes("attendance.view") || authUser.permissions.includes("hr.manage")));

  if (authUser.role === "SUPER_ADMIN") {
    if (filters.organizationId || authUser.organizationId) query.organizationId = filters.organizationId || authUser.organizationId;
    if (filters.userId) query.userId = filters.userId;
    if (filters.departmentId) query.departmentId = filters.departmentId;
    if (filters.teamId) query.teamId = filters.teamId;
    if (filters.attendanceStatus) query.attendanceStatus = filters.attendanceStatus;
  } else if (authUser.role === "ADMIN" || isHrAuthorized) {
    query.organizationId = authUser.organizationId;
    if (filters.userId) query.userId = filters.userId;
    if (filters.departmentId) query.departmentId = filters.departmentId;
    if (filters.teamId) query.teamId = filters.teamId;
    if (filters.attendanceStatus) query.attendanceStatus = filters.attendanceStatus;
  } else if (authUser.role === "DIVISION_ADMIN") {
    if (!authUser.divisionId) {
      throw new Error("DIVISION_REQUIRED");
    }
    query.organizationId = authUser.organizationId;
    const divisionUsers = await User.find({ divisionId: authUser.divisionId }).distinct("_id");
    const divUserIds = divisionUsers.map((id) => String(id));
    if (filters.userId) {
      if (!divUserIds.includes(String(filters.userId))) {
        throw new Error("USER_OUTSIDE_SCOPE");
      }
      query.userId = filters.userId;
    } else {
      query.userId = { $in: divisionUsers };
    }
    if (filters.attendanceStatus) query.attendanceStatus = filters.attendanceStatus;
  } else if (authUser.role === "MANAGER" || authUser.role === "TEAM_LEADER") {
    const scope = await getManagementScope(authUser);
    query.organizationId = authUser.organizationId;
    if (filters.userId) {
      if (!scope.scopedUserIds.includes(String(filters.userId))) {
        throw new Error("USER_OUTSIDE_SCOPE");
      }
      query.userId = filters.userId;
    } else {
      query.userId = { $in: scope.scopedUserIds };
    }
    if (filters.attendanceStatus) query.attendanceStatus = filters.attendanceStatus;
  } else {
    // EMPLOYEE / INTERN: strictly own attendance
    query.userId = authUser._id;
    if (filters.attendanceStatus) query.attendanceStatus = filters.attendanceStatus;
  }

  if (filters.dateFrom || filters.dateTo) {
    query.date = {};
    if (filters.dateFrom) query.date.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) query.date.$lte = new Date(filters.dateTo);
  }

  return query;
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const parsedFilters = AttendanceFilterSchema.safeParse({
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      userId: url.searchParams.get("userId") || undefined,
      departmentId: url.searchParams.get("departmentId") || undefined,
      teamId: url.searchParams.get("teamId") || undefined,
      attendanceStatus: url.searchParams.get("attendanceStatus") || undefined,
      organizationId: url.searchParams.get("organizationId") || undefined,
      page: url.searchParams.get("page") || "1",
      limit: url.searchParams.get("limit") || "20",
    });

    if (!parsedFilters.success) return error("VALIDATION_ERROR", parsedFilters.error.message, 422);

    let query;
    try {
      query = await buildHistoryQuery(user, parsedFilters.data);
    } catch (e: any) {
      if (e.message === "USER_OUTSIDE_SCOPE") {
        return error("FORBIDDEN", "Requested user is outside your management scope", 403);
      }
      if (e.message === "DIVISION_REQUIRED") {
        return error("FORBIDDEN", "Division administrator has no assigned division.", 403);
      }
      throw e;
    }

    if (parsedFilters.data.departmentId || parsedFilters.data.teamId) {
      const userFilter: Record<string, unknown> = {};
      if (query.organizationId) userFilter.organizationId = query.organizationId;
      if (parsedFilters.data.departmentId) userFilter.departmentId = parsedFilters.data.departmentId;
      if (parsedFilters.data.teamId) userFilter.teamId = parsedFilters.data.teamId;
      const matchingUsers = await User.find(userFilter).select("_id").lean();
      query.userId = { $in: matchingUsers.map((item) => item._id) };
      delete query.departmentId;
      delete query.teamId;
    }

    const page = parsedFilters.data.page;
    const limit = parsedFilters.data.limit;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Attendance.find(query)
        .populate("userId", "fullName email employeeId designation role departmentId teamId divisionId")
        .populate("teamId", "name code")
        .populate("departmentId", "name code")
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(query),
    ]);

    return success({ items, total, page, limit });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to fetch attendance history";
    return error("ATTENDANCE_HISTORY_FAILED", message, 500);
  }
}
