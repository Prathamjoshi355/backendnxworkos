import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as hrService from "../../../../../../services/hrService";
import User from "../../../../../../models/User";
import { success, error } from "../../../../../../utils/response";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const isSelf = String(user._id || user.id) === String(id);
    if (!hrService.isHrOrAdmin(user) && !isSelf) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const employee = await User.findById(id).select("onboardingStatus onboardingChecklist organizationId").lean();
    if (!employee) return error("NOT_FOUND", "Employee not found", 404);

    if (user.role !== "SUPER_ADMIN" && String(employee.organizationId) !== String(user.organizationId)) {
      return error("FORBIDDEN", "Forbidden - cross-organization access", 403);
    }

    const checklist =
      employee.onboardingChecklist && employee.onboardingChecklist.length > 0
        ? employee.onboardingChecklist
        : hrService.DEFAULT_ONBOARDING_CHECKLIST.map((c) => ({
            key: c.key,
            title: c.title,
            completed: false,
            completedAt: null,
            completedBy: null,
          }));

    return success({
      onboardingStatus: employee.onboardingStatus || "PENDING",
      checklist,
    });
  } catch (err: any) {
    console.error("GET /api/hr/employees/[id]/onboarding error:", err);
    return error("FAILED", err.message || "Failed to load onboarding checklist", 500);
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

    if (!body.itemKey || typeof body.completed !== "boolean") {
      return error("VALIDATION_ERROR", "itemKey and completed status are required", 422);
    }

    const res = await hrService.updateOnboardingChecklist(user, id, body.itemKey, body.completed);
    return success(res);
  } catch (err: any) {
    console.error("PATCH /api/hr/employees/[id]/onboarding error:", err);
    if (err.message === "EMPLOYEE_NOT_FOUND") return error("NOT_FOUND", "Employee not found", 404);
    if (err.message === "CHECKLIST_ITEM_NOT_FOUND") return error("NOT_FOUND", "Checklist item not found", 404);
    return error("FAILED", err.message || "Failed to update onboarding checklist", 500);
  }
}
