import { NextRequest } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getPayrollDashboardMetrics } from "../../../../services/payrollService";
import { success, error, handleApiError } from "../../../../utils/response";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "HR", "DIVISION_ADMIN", "MANAGER"])) {
      return error("FORBIDDEN", "You do not have access to the HR Payroll Dashboard", 403);
    }

    const { searchParams } = new URL(request.url);
    const orgId =
      user.role === "SUPER_ADMIN" && searchParams.get("organizationId")
        ? searchParams.get("organizationId")!
        : String(user.organizationId || "");

    if (!orgId) {
      return error("VALIDATION_ERROR", "Organization ID is required", 400);
    }

    const now = new Date();
    const month = searchParams.get("month") ? parseInt(searchParams.get("month")!, 10) : now.getMonth() + 1;
    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : now.getFullYear();

    const divisionId =
      user.role === "DIVISION_ADMIN" && user.divisionId
        ? String(user.divisionId)
        : searchParams.get("divisionId") || undefined;

    const departmentId = searchParams.get("departmentId") || undefined;

    const metrics = await getPayrollDashboardMetrics(
      orgId,
      month,
      year,
      { divisionId, departmentId },
      user
    );

    return success(metrics);
  } catch (err: unknown) {
    return handleApiError(err, "PAYROLL_DASHBOARD_FAILED", "Failed to retrieve payroll dashboard metrics", 500);
  }
}

