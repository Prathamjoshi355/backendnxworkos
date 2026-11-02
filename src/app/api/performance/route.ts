import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import { PerformanceSnapshot } from "../../../models/PerformanceSnapshot";
import User from "../../../models/User";
import { PointTransaction } from "../../../models/PointTransaction";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) return error("FORBIDDEN", "Forbidden", 403);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");
    const organizationId = url.searchParams.get("organizationId") || user.organizationId;
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const teamId = url.searchParams.get("teamId") || undefined;
    const employmentType = url.searchParams.get("employmentType") || undefined;
    const periodType = url.searchParams.get("periodType") || undefined;

    const userFilter: Record<string, unknown> = {};
    if (organizationId) userFilter.organizationId = String(organizationId);
    if (departmentId) userFilter.departmentId = departmentId;
    if (teamId) userFilter.teamId = teamId;
    if (employmentType) userFilter.employmentType = employmentType;
    if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") userFilter._id = String(user._id);

    const users = await User.find(userFilter).select("employeeId fullName role employmentType departmentId teamId organizationId").lean();
    const userIds = users.map((item) => item._id);
    const perfFilter: Record<string, unknown> = { userId: { $in: userIds } };
    if (organizationId) perfFilter.organizationId = String(organizationId);
    if (periodType) perfFilter.periodType = periodType;

    const snapshots = await PerformanceSnapshot.find(perfFilter).sort({ periodStart: -1 }).lean();
    const latestByUser = new Map<string, any>();
    for (const snapshot of snapshots) {
      const key = String(snapshot.userId);
      if (!latestByUser.has(key)) latestByUser.set(key, snapshot);
    }

    const points = await PointTransaction.aggregate([
      { $match: { userId: { $in: userIds }, ...(organizationId ? { organizationId } : {}) } },
      { $group: { _id: "$userId", total: { $sum: { $cond: [{ $eq: ["$type", "EARNED"] }, "$points", { $multiply: ["$points", -1] }] } } } },
    ]);
    const pointsByUser = new Map(points.map((item: any) => [String(item._id), item.total]));

    const items = users.slice((page - 1) * limit, page * limit).map((employee) => {
      const snapshot = latestByUser.get(String(employee._id));
      return {
        employee,
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        employmentType: employee.employmentType,
        departmentId: employee.departmentId,
        teamId: employee.teamId,
        score: snapshot?.performanceScore || 0,
        taskCompletion: snapshot?.taskCompletionScore || 0,
        timeliness: snapshot?.timelinessScore || 0,
        attendance: snapshot?.attendanceScore || 0,
        targetScore: snapshot?.targetScore || 0,
        consistency: snapshot?.consistencyScore || 0,
        productivity: snapshot?.productivityScore || 0,
        points: pointsByUser.get(String(employee._id)) || 0,
        snapshot,
      };
    });

    return success({ items, total: users.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load performance";
    return error("PERFORMANCE_LIST_FAILED", message, 500);
  }
}
