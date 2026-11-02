import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as hrService from "../../../../../../services/hrService";
import { success, error } from "../../../../../../utils/response";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!hrService.isHrOrAdmin(user)) {
      return error("FORBIDDEN", "Forbidden - requires HR or Admin role", 403);
    }

    const { id } = await context.params;
    const body = await request.json();

    const updated = await hrService.updateEmployeeLifecycle(user, id, body);
    return success({ employee: updated });
  } catch (err: any) {
    console.error("POST /api/hr/employees/[id]/lifecycle error:", err);
    if (err.message === "EMPLOYEE_NOT_FOUND") return error("NOT_FOUND", "Employee not found", 404);
    if (err.message.includes("INVALID_LIFECYCLE_TRANSITION")) return error("INVALID_TRANSITION", err.message, 422);
    if (err.message === "FORBIDDEN_ORGANIZATION_ACCESS") return error("FORBIDDEN", "Forbidden - cross-organization access", 403);
    return error("FAILED", err.message || "Failed to update lifecycle status", 500);
  }
}
