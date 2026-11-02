import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import * as leaveService from "../../../services/leaveService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const types = await leaveService.listLeaveTypes(String(user.organizationId));
    return success({ leaveTypes: types });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load leave types";
    return error("LEAVE_TYPES_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) return error("FORBIDDEN", "Only Admin or Super Admin can create leave types", 403);

    const body = await request.json();
    if (!body.name || !body.code) return error("VALIDATION_ERROR", "Name and code are required", 422);

    const leaveType = await leaveService.createLeaveType(String(user.organizationId), body);
    return success({ leaveType });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to create leave type";
    return error("LEAVE_TYPE_CREATE_FAILED", message, 500);
  }
}
