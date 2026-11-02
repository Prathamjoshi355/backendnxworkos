import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as crmCallService from "../../../../../services/crmCallService";
import { success, error } from "../../../../../utils/response";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await context.params;
  const body = await request.json();
  if (!body.outcome) return error("VALIDATION_ERROR", "outcome is required", 422);

  try {
    const result = await crmCallService.recordOutcome({
      organizationId: String(user.organizationId),
      leadId: id,
      employeeId: String(user._id),
      outcome: body.outcome,
      remark: body.remark,
      rejectionReason: body.rejectionReason,
      followUpDate: body.followUpDate,
      nextAction: body.nextAction,
      priority: body.priority,
    });
    return success(result);
  } catch (err: any) {
    return error("OUTCOME_RECORD_FAILED", err.message || "Failed to record call outcome", 500);
  }
}
