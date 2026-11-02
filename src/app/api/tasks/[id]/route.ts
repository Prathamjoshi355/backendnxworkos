import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getTaskById, updateTask } from "../../../../services/taskService";
import { TaskUpdateSchema } from "../../../../validators/task";
import { getManagementScope, canUserAssignWorkTo } from "../../../../utils/scopeHelper";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const task: any = await getTaskById(id);
    if (!task) return error("NOT_FOUND", "Task not found", 404);

    const currentUserId = String(user._id || user.id);
    const taskAssigneeId = String(task.assignedTo?._id || task.assignedTo);
    const taskAssignerId = String(task.assignedBy?._id || task.assignedBy);
    const taskTeamId = task.teamId ? String(task.teamId?._id || task.teamId) : null;
    const taskOrgId = task.organizationId ? String(task.organizationId?._id || task.organizationId) : null;

    if (user.role === "SUPER_ADMIN") {
      return success({ task });
    }

    if (user.role === "ADMIN") {
      if (taskOrgId && taskOrgId !== String(user.organizationId)) {
        return error("FORBIDDEN", "Cross-organization access is not allowed.", 403);
      }
      return success({ task });
    }

    if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      if (taskOrgId && taskOrgId !== String(user.organizationId)) {
        return error("FORBIDDEN", "Cross-organization access is not allowed.", 403);
      }

      const isSelf = taskAssigneeId === currentUserId || taskAssignerId === currentUserId;
      if (isSelf) return success({ task });

      const scope = await getManagementScope(user);
      const isUserInScope = scope.scopedUserIds.includes(taskAssigneeId);
      const isTeamInScope = taskTeamId ? scope.managedTeamIds.includes(taskTeamId) : false;

      if (!isUserInScope && !isTeamInScope) {
        return error("FORBIDDEN", "Task is outside your management scope.", 403);
      }
      return success({ task });
    }

    // Standard employee: strictly own tasks
    if (taskAssigneeId !== currentUserId) {
      return error("FORBIDDEN", "You do not have permission to view this task.", 403);
    }

    return success({ task });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to fetch task";
    return error("TASK_FETCH_FAILED", message, 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const existing: any = await getTaskById(id);
    if (!existing) return error("NOT_FOUND", "Task not found", 404);

    const currentUserId = String(user._id || user.id);
    const taskAssigneeId = String(existing.assignedTo?._id || existing.assignedTo);
    const taskAssignerId = String(existing.assignedBy?._id || existing.assignedBy);
    const taskTeamId = existing.teamId ? String(existing.teamId?._id || existing.teamId) : null;
    const taskOrgId = existing.organizationId ? String(existing.organizationId?._id || existing.organizationId) : null;

    if (user.role !== "SUPER_ADMIN" && taskOrgId && taskOrgId !== String(user.organizationId)) {
      return error("FORBIDDEN", "Cross-organization access is not allowed.", 403);
    }

    const isPrivileged = ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role);

    if (!isPrivileged) {
      if (taskAssigneeId !== currentUserId) {
        return error("FORBIDDEN", "You do not have permission to modify this task.", 403);
      }
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      const isSelf = taskAssigneeId === currentUserId || taskAssignerId === currentUserId;
      if (!isSelf) {
        const scope = await getManagementScope(user);
        const isUserInScope = scope.scopedUserIds.includes(taskAssigneeId);
        const isTeamInScope = taskTeamId ? scope.managedTeamIds.includes(taskTeamId) : false;
        if (!isUserInScope && !isTeamInScope) {
          return error("FORBIDDEN", "Task is outside your management scope.", 403);
        }
      }
    }

    const body = await request.json();
    const parsed = TaskUpdateSchema.safeParse(body);
    if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

    let updateData: any = { ...parsed.data };

    // Employee field-level protection: employees cannot self-reassign, change points, priority, or ownership
    if (!isPrivileged) {
      delete updateData.assignedTo;
      delete updateData.assignedBy;
      delete updateData.creditPoints;
      delete updateData.priority;
      delete updateData.dueDate;
      delete updateData.category;
      delete updateData.teamId;
      delete updateData.organizationId;
    } else if (updateData.assignedTo && String(updateData.assignedTo) !== taskAssigneeId) {
      // Reassignment authority check
      const allowed = await canUserAssignWorkTo(user, {
        targetUserId: String(updateData.assignedTo),
        targetTeamId: updateData.teamId ? String(updateData.teamId) : null,
      });
      if (!allowed) {
        return error("FORBIDDEN", "You are not authorized to assign work to the selected target user.", 403);
      }
      updateData.assignedBy = currentUserId;
    }

    // Attach remark author context
    if (body.remark || body.comment) {
      updateData.remark = body.remark || body.comment;
      updateData.remarkUserId = currentUserId;
      updateData.remarkUserName = user.fullName;
      updateData.remarkUserRole = user.role;
    }

    const updated = await updateTask(id, updateData);
    return success({ task: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to update task";
    return error("TASK_UPDATE_FAILED", message, 500);
  }
}
