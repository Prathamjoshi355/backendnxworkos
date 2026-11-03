import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { exportPayrollExcel } from "../../../../services/payrollService";
import { error, handleApiError } from "../../../../utils/response";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "HR", "DIVISION_ADMIN"])) {
      return error("FORBIDDEN", "Only Administrators and HR personnel can export payroll registers", 403);
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
    const employmentClassification = searchParams.get("employmentClassification") as any;
    const status = searchParams.get("status") as any;

    const { filename, xmlContent } = await exportPayrollExcel(
      orgId,
      month,
      year,
      { divisionId, departmentId, employmentClassification, status },
      user
    );

    return new NextResponse(xmlContent, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    return handleApiError(err, "PAYROLL_EXPORT_FAILED", "Failed to export payroll register", 500);
  }
}

