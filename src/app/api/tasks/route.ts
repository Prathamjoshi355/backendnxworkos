import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import { createTask, listTasks, validateTaskAssignment } from "../../../services/taskService";
import { TaskCreateSchema } from "../../../validators/task";
import { getManagementScope } from "../../../utils/scopeHelper";
import { success, error } from "../../../utils/response";
import { logger } from "../../../utils/logger";
import "../../../models/Department";
import "../../../models/Team";

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const body = await request.json();
    const parsed = TaskCreateSchema.safeParse(body);
    if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

    try {
      await validateTaskAssignment(user, parsed.data);
    } catch (valErr: any) {
      if (valErr.message === "CANNOT_ASSIGN_TO_OTHERS") {
        return error("FORBIDDEN", "Employees are only permitted to self-assign tasks to themselves.", 403);
      }
      if (valErr.message === "CANNOT_ASSIGN_OUTSIDE_SCOPE") {
        return error("FORBIDDEN", "You are not authorized to assign tasks to this user or team outside your management scope.", 403);
      }
      if (valErr.message === "INVALID_ORGANIZATION") {
        return error("FORBIDDEN", "Cannot create tasks for another organization.", 403);
      }
      if (valErr.message === "ROLE_CATEGORY_NOT_ALLOWED") {
        return error("FORBIDDEN", `Your role is not authorized to create tasks of category ${parsed.data.category || 'GENERAL'}.`, 403);
      }
      return error("FORBIDDEN", valErr.message || "Forbidden", 403);
    }

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const isManagerOrAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role);

    const targetUserId = isManagerOrAdmin ? (parsed.data.assignedTo || String(user._id)) : String(user._id);
    const assignerId = String(user._id || user.id);

    const targetUserDoc: any = await (await import("../../../models/User")).default.findById(targetUserId).lean();
    if (!targetUserDoc) return error("NOT_FOUND", "Assigned user was not found", 404);

    const targetOrgId = isSuperAdmin
      ? (parsed.data.organizationId || String(targetUserDoc.organizationId || user.organizationId || ""))
      : String(user.organizationId || targetUserDoc.organizationId || "");

    const taskPayload = {
      ...parsed.data,
      assignedTo: targetUserId,
      assignedBy: assignerId,
      organizationId: targetOrgId,
      departmentId: parsed.data.departmentId || targetUserDoc.departmentId || null,
      teamId: parsed.data.teamId || targetUserDoc.teamId || null,
    };

    const created = await createTask(taskPayload);
    return success({ task: created }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to create task";
    if (message === "TITLE_REQUIRED") return error("TITLE_REQUIRED", "Title is required", 422);
    if (message === "ASSIGNED_TO_REQUIRED") return error("ASSIGNED_TO_REQUIRED", "Assigned user is required", 422);
    if (message === "ASSIGNED_USER_NOT_FOUND") return error("ASSIGNED_USER_NOT_FOUND", "Assigned user was not found", 404);
    return error("TASK_CREATE_FAILED", message, 500);
  }
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");
    const skip = (page - 1) * limit;
    const assignedTo = url.searchParams.get("assignedTo") || undefined;
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const teamId = url.searchParams.get("teamId") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const search = url.searchParams.get("search") || undefined;

    const filter: Record<string, any> = {};

    if (user.role === "SUPER_ADMIN") {
      const orgParam = url.searchParams.get("organizationId");
      if (orgParam) filter.organizationId = orgParam;
      if (assignedTo) filter.assignedTo = assignedTo;
    } else if (user.role === "ADMIN") {
      filter.organizationId = user.organizationId;
      if (assignedTo) filter.assignedTo = assignedTo;
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      const scope = await getManagementScope(user);
      filter.organizationId = user.organizationId;
      if (assignedTo) {
        if (!scope.scopedUserIds.includes(String(assignedTo))) {
          return error("FORBIDDEN", "Target user is outside your management scope", 403);
        }
        filter.assignedTo = assignedTo;
      } else {
        filter.$or = [
          { assignedTo: { $in: scope.scopedUserIds } },
          { assignedBy: String(user._id || user.id) },
          ...(scope.managedTeamIds.length > 0 ? [{ teamId: { $in: scope.managedTeamIds } }] : []),
        ];
      }
    } else {
      filter.organizationId = user.organizationId;
      filter.assignedTo = String(user._id || user.id);
    }

    if (departmentId) filter.departmentId = departmentId;
    if (teamId) filter.teamId = teamId;
    if (status) filter.status = status;
    if (search) {
      const searchConditions = [
        { title: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
        { taskId: new RegExp(search, "i") },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    const result = await listTasks(filter, { skip, limit, sort: { createdAt: -1 } });
    return success(result);
  } catch (err: unknown) {
    const errorObj = err as any;
    logger.error("[GET /api/tasks error]", { message: errorObj?.message, stack: errorObj?.stack });
    const message = err instanceof Error ? err.message : "Unable to fetch tasks";
    return error("TASK_LIST_FAILED", message, 500);
  }
}
