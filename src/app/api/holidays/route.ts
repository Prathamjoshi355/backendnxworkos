import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import {
  getHolidaysForOrganization,
  createHoliday,
  initializeDefaultHolidaysForOrg,
} from "../../../services/holidayService";
import { success, error } from "../../../utils/response";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const { searchParams } = new URL(request.url);
    const orgId = user.role === "SUPER_ADMIN" && searchParams.get("organizationId")
      ? searchParams.get("organizationId")!
      : String(user.organizationId || "");

    if (!orgId) {
      return error("VALIDATION_ERROR", "Organization ID is required", 400);
    }

    const yearParam = searchParams.get("year");
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

    let holidays = await getHolidaysForOrganization(orgId, { year });

    // Auto-seed default government holidays if none exist for this org and year
    if (holidays.length === 0) {
      await initializeDefaultHolidaysForOrg(orgId, year, user._id || user.id);
      holidays = await getHolidaysForOrganization(orgId, { year });
    }

    return success({ holidays, total: holidays.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve holidays";
    return error("HOLIDAYS_FETCH_FAILED", message, 500);
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
      return error("FORBIDDEN", "Only Administrators and HR can manage holidays", 403);
    }

    const body = await request.json().catch(() => ({}));

    if (body.action === "INITIALIZE_DEFAULTS") {
      const orgId = user.role === "SUPER_ADMIN" && body.organizationId
        ? body.organizationId
        : String(user.organizationId || "");
      const year = body.year ? parseInt(body.year, 10) : new Date().getFullYear();
      const result = await initializeDefaultHolidaysForOrg(orgId, year, user._id || user.id);
      const holidays = await getHolidaysForOrganization(orgId, { year });
      return success({ message: "Default government holidays initialized", result, holidays });
    }

    if (!body.name || !body.date) {
      return error("VALIDATION_ERROR", "Holiday name and date are required", 422);
    }

    const holiday = await createHoliday(user, {
      name: body.name,
      date: body.date,
      isGovernmentHoliday: body.isGovernmentHoliday ?? true,
      description: body.description,
    });

    return success({ holiday }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create holiday";
    return error("HOLIDAY_CREATE_FAILED", message, 500);
  }
}

