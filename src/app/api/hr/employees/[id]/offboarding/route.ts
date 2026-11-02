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
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!hrService.isHrOrAdmin(user)) {
      return error("FORBIDDEN", "Forbidden - requires HR or Admin role", 403);
    }

    const { id } = await context.params;
    const body = await request.json();

    const updated = await hrService.updateEmployeeLifecycle(user, id, {
      status: "NOTICE_PERIOD",
      exitNoticeDate: body.exitNoticeDate || new Date(),
      exitDate: body.exitDate || null,
      exitReason: body.exitReason || "Resignation / Exit initiated",
    });

    return success({ employee: updated });
  } catch (err: any) {
    console.error("POST /api/hr/employees/[id]/offboarding error:", err);
    if (err.message === "EMPLOYEE_NOT_FOUND") return error("NOT_FOUND", "Employee not found", 404);
    if (err.message.includes("INVALID_LIFECYCLE_TRANSITION")) return error("INVALID_TRANSITION", err.message, 422);
    return error("FAILED", err.message || "Failed to initiate offboarding", 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!hrService.isHrOrAdmin(user)) {
      return error("FORBIDDEN", "Forbidden - requires HR or Admin role", 403);
    }

    const { id } = await context.params;
    const body = await request.json();

    const validDepts = ["it", "finance", "admin", "hr"];
    if (!body.department || !validDepts.includes(body.department) || typeof body.cleared !== "boolean") {
      return error("VALIDATION_ERROR", "Valid department (it, finance, admin, hr) and cleared status required", 422);
    }

    const clearance = await hrService.updateOffboardingClearance(user, id, body.department, body.cleared);
    return success({ clearanceStatus: clearance });
  } catch (err: any) {
    console.error("PATCH /api/hr/employees/[id]/offboarding error:", err);
    if (err.message === "EMPLOYEE_NOT_FOUND") return error("NOT_FOUND", "Employee not found", 404);
    return error("FAILED", err.message || "Failed to update clearance status", 500);
  }
}
