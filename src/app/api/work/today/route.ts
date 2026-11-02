import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import Attendance from "../../../../models/Attendance";
import Task from "../../../../models/Task";
import User from "../../../../models/User";
import { success, error } from "../../../../utils/response";

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId") || user.organizationId;
    const { start, end } = todayBounds();

    let users: any[] = [];
    if (["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role)) {
      users = await User.find(organizationId ? { organizationId } : {}).select("fullName employeeId departmentId teamId").lean();
    } else {
      users = [user];
    }
    const userIds = users.map((item) => item._id);
    const [tasks, attendance] = await Promise.all([
      Task.aggregate([
        { $match: { assignedTo: { $in: userIds }, ...(organizationId ? { organizationId } : {}) } },
        { $group: { _id: "$assignedTo", assigned: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }, pending: { $sum: { $cond: [{ $in: ["$status", ["ASSIGNED", "TODO", "IN_PROGRESS", "PAUSED", "REVIEW", "REWORK"]] }, 1, 0] } }, overdue: { $sum: { $cond: [{ $eq: ["$status", "OVERDUE"] }, 1, 0] } } } },
      ]),
      Attendance.find({ userId: { $in: userIds }, date: { $gte: start, $lt: end } }).lean(),
    ]);
    const tasksByUser = new Map(tasks.map((item: any) => [String(item._id), item]));
    const attendanceByUser = new Map(attendance.map((item: any) => [String(item.userId), item]));
    const items = users.map((employee) => {
      const task = tasksByUser.get(String(employee._id)) || {};
      const day = attendanceByUser.get(String(employee._id)) || {};
      const assigned = Number(task.assigned || 0);
      const completed = Number(task.completed || 0);
      return {
        employee,
        assigned,
        completed,
        pending: Number(task.pending || 0),
        overdue: Number(task.overdue || 0),
        workTime: Number(day.totalWorkDuration || 0),
        breakTime: Number(day.totalBreakDuration || 0),
        progress: assigned > 0 ? Math.round((completed / assigned) * 100) : 0,
      };
    });
    return success({ items, total: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load work summary";
    return error("WORK_TODAY_FAILED", message, 500);
  }
}
