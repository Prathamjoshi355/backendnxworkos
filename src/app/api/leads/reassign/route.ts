import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requirePermission } from "../../../../middleware/auth";
import * as leadAssignmentService from "../../../../services/leadAssignmentService";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  if (!requirePermission(user, "lead.assign") && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    return error("FORBIDDEN", "Not authorized to reassign leads", 403);
  }

  const body = await request.json();
  if (!body.leadId || !body.newEmployeeId) {
    return error("VALIDATION_ERROR", "leadId and newEmployeeId are required", 422);
  }

  try {
    const lead = await leadAssignmentService.reassignLead({
      organizationId: String(user.organizationId),
      leadId: body.leadId,
      newEmployeeId: body.newEmployeeId,
      reassignedBy: String(user._id),
      reason: body.reason,
    });
    return success({ lead });
  } catch (err: any) {
    return error("REASSIGNMENT_FAILED", err.message || "Lead reassignment failed", 500);
  }
}
