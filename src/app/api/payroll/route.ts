import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import {
  listPayrolls,
  generateMonthlyPayroll,
} from "../../../services/payrollService";
import { success, error, handleApiError } from "../../../utils/response";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const { searchParams } = new URL(request.url);
    const orgId =
      user.role === "SUPER_ADMIN" && searchParams.get("organizationId")
        ? searchParams.get("organizationId")!
        : String(user.organizationId || "");

    if (!orgId) {
      return error("VALIDATION_ERROR", "Organization ID is required", 400);
    }

    const month = searchParams.get("month") ? parseInt(searchParams.get("month")!, 10) : undefined;
    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : undefined;
    const departmentId = searchParams.get("departmentId") || undefined;
    const divisionId = searchParams.get("divisionId") || undefined;
    const employmentType = searchParams.get("employmentType") as any;
    const employmentClassification = searchParams.get("employmentClassification") as any;
    const status = searchParams.get("status") as any;
    const search = searchParams.get("search") || undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;

    const result = await listPayrolls(
      orgId,
      {
        payrollMonth: month,
        payrollYear: year,
        departmentId,
        divisionId,
        employmentType,
        employmentClassification,
        status,
        search,
        page,
        limit,
      },
      user
    );

    return success(result);
  } catch (err: unknown) {
    return handleApiError(err, "PAYROLL_LIST_FAILED", "Failed to load payroll records", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "HR"])) {
      return error("FORBIDDEN", "Only Administrators and HR personnel can generate payroll.", 403);
    }

    const body = await request.json().catch(() => ({}));
    const orgId =
      user.role === "SUPER_ADMIN" && body.organizationId
        ? body.organizationId
        : String(user.organizationId || "");

    if (!orgId) {
      return error("VALIDATION_ERROR", "Organization ID is required", 400);
    }

    const month = parseInt(body.month, 10);
    const year = parseInt(body.year, 10);

    if (isNaN(month) || month < 1 || month > 12) {
      return error("VALIDATION_ERROR", "Valid month (1-12) is required", 422);
    }
    if (isNaN(year) || year < 2020 || year > 2100) {
      return error("VALIDATION_ERROR", "Valid year is required", 422);
    }

    const options = {
      departmentId: body.departmentId,
      divisionId: body.divisionId,
      employmentClassification: body.employmentClassification,
      userIds: body.userIds,
      overwriteDraft: Boolean(body.overwriteDraft),
    };

    const result = await generateMonthlyPayroll(orgId, month, year, options, user);
    return success(result, 201);
  } catch (err: unknown) {
    return handleApiError(err, "PAYROLL_GENERATION_FAILED", "Failed to generate monthly payroll", 500);
  }
}

