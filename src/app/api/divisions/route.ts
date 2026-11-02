import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import * as divisionService from "../../../services/divisionService";
import { success, error, handleApiError } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser) {
      return error("UNAUTHORIZED", "Authentication required", 401);
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const search = url.searchParams.get("search") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const organizationId = url.searchParams.get("organizationId") || undefined;

    const result = await divisionService.listDivisions(authUser, {
      page,
      limit,
      search,
      status,
      includeInactive,
      organizationId,
    });

    return success(result);
  } catch (err: unknown) {
    return handleApiError(err, "DIVISIONS_FETCH_FAILED", "Failed to retrieve divisions");
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser) {
      return error("UNAUTHORIZED", "Authentication required", 401);
    }

    if (!requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Only Administrators can create divisions", 403);
    }

    const body = await request.json();
    const created = await divisionService.createDivision(authUser, body);

    return success(created, 201);
  } catch (err: any) {
    if (err.message?.includes("RESERVED_DIVISION_NAME_PROHIBITED")) {
      return error("RESERVED_NAME_PROHIBITED", err.message, 422);
    }
    if (err.message?.includes("DIVISION_NAME_EXISTS") || err.message?.includes("DIVISION_CODE_EXISTS")) {
      return error("DUPLICATE_DIVISION", err.message, 409);
    }
    if (err.message?.includes("INVALID_DIVISION_CODE")) {
      return error("INVALID_DIVISION_CODE", err.message, 422);
    }
    if (err.message?.includes("CROSS_TENANT_REFERENCE") || err.message?.includes("INACTIVE_USER")) {
      return error("INVALID_DIVISION_HEAD", err.message, 422);
    }
    return handleApiError(err, "DIVISION_CREATION_FAILED", err.message || "Failed to create division");
  }
}

