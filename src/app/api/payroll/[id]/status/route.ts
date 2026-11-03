import { NextRequest } from "next/server";
import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { updatePayrollStatus } from "../../../../../services/payrollService";
import { success, error, handleApiError } from "../../../../../utils/response";

async function getId(context: any): Promise<string> {
  const p = await (context?.params || {});
  return p.id;
}

export async function PATCH(request: NextRequest, context: any) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "HR"])) {
      return error("FORBIDDEN", "Only Administrators and HR personnel can review and approve payroll", 403);
    }

    const id = await getId(context);
    const body = await request.json().catch(() => ({}));
    const { status: targetStatus, notes } = body;

    if (!targetStatus || !["DRAFT", "UNDER_REVIEW", "APPROVED"].includes(targetStatus)) {
      return error("VALIDATION_ERROR", "Invalid target status. Must be DRAFT, UNDER_REVIEW, or APPROVED.", 422);
    }

    const updated = await updatePayrollStatus(id, targetStatus, notes, user);
    return success({ payroll: updated });
  } catch (err: unknown) {
    return handleApiError(err, "PAYROLL_STATUS_UPDATE_FAILED", "Failed to update payroll status", 500);
  }
}

