import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requirePermission } from "../../../../middleware/auth";
import * as leadAssignmentService from "../../../../services/leadAssignmentService";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  if (!requirePermission(user, "lead.assign") && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    return error("FORBIDDEN", "Not authorized to assign leads", 403);
  }

  const body = await request.json();
  if (!body.mode) return error("VALIDATION_ERROR", "Assignment mode is required", 422);

  try {
    const result = await leadAssignmentService.assignLeads({
      organizationId: String(user.organizationId),
      assignedBy: String(user._id),
      mode: body.mode,
      leadIds: body.leadIds,
      productId: body.productId,
      employeeId: body.employeeId,
      employeeIds: body.employeeIds,
      reason: body.reason,
    });
    return success(result);
  } catch (err: any) {
    return error("ASSIGNMENT_FAILED", err.message || "Lead assignment failed", 500);
  }
}
