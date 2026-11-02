import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as leaveService from "../../../services/leaveService";
import { getManagementScope } from "../../../utils/scopeHelper";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "20");
    const status = url.searchParams.get("status") || undefined;
    const targetUserId = url.searchParams.get("userId") || undefined;
    const leaveTypeId = url.searchParams.get("leaveTypeId") || undefined;
    const departmentId = url.searchParams.get("departmentId") || undefined;

    const filter: Record<string, unknown> = {};

    // Organization scoping
    if (user.role !== "SUPER_ADMIN") {
      filter.organizationId = user.organizationId;
    } else if (url.searchParams.get("organizationId")) {
      filter.organizationId = url.searchParams.get("organizationId");
    }

    // Role & Ownership scoping
    if (user.role === "SUPER_ADMIN") {
      if (targetUserId) filter.userId = targetUserId;
    } else if (user.role === "ADMIN") {
      if (targetUserId) filter.userId = targetUserId;
    } else if (user.role === "MANAGER" || user.role === "TEAM_LEADER") {
      const scope = await getManagementScope(user);
      if (targetUserId) {
        if (!scope.scopedUserIds.includes(String(targetUserId))) {
          return error("FORBIDDEN", "Target user is outside your management scope", 403);
        }
        filter.userId = targetUserId;
      } else {
        filter.userId = { $in: scope.scopedUserIds };
      }
    } else {
      // Employee tiers
      filter.userId = user._id || user.id;
    }

    if (status && status !== "ALL") filter.status = status;
    if (leaveTypeId) filter.leaveTypeId = leaveTypeId;
    if (departmentId && !filter.departmentId) filter.departmentId = departmentId;

    const result = await leaveService.listLeaves(filter, { skip: (page - 1) * limit, limit });
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load leaves";
    return error("LEAVE_LIST_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();
    if (!body.reason || !body.startDate || !body.endDate) {
      return error("VALIDATION_ERROR", "Reason, start date, and end date are required", 422);
    }

    const leave = await leaveService.applyLeave(user, body);
    return success({ leave }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to apply for leave";
    if (message === "LEAVE_OVERLAP") return error("CONFLICT", "You already have an active leave request overlapping these dates", 409);
    if (message === "INSUFFICIENT_LEAVE_BALANCE") return error("VALIDATION_ERROR", "Insufficient leave balance for this leave type", 422);
    if (message === "END_DATE_BEFORE_START_DATE") return error("VALIDATION_ERROR", "End date cannot be before start date", 422);
    if (message === "INVALID_DATES") return error("VALIDATION_ERROR", "Invalid start or end date", 422);
    return error("LEAVE_APPLY_FAILED", message, 500);
  }
}
