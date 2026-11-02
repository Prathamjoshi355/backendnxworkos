import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import * as divisionService from "../../../../services/divisionService";
import { success, error, handleApiError } from "../../../../utils/response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser) {
      return error("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;
    const division = await divisionService.getDivisionById(authUser, id);
    if (!division) {
      return error("NOT_FOUND", "Division not found", 404);
    }

    return success(division);
  } catch (err: unknown) {
    return handleApiError(err, "DIVISION_FETCH_FAILED", "Failed to retrieve division");
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser) {
      return error("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const updated = await divisionService.updateDivision(authUser, id, body);

    return success(updated);
  } catch (err: any) {
    if (err.message?.includes("RESERVED_DIVISION_NAME_PROHIBITED")) {
      return error("RESERVED_NAME_PROHIBITED", err.message, 422);
    }
    if (err.message?.includes("DIVISION_NAME_EXISTS") || err.message?.includes("DIVISION_CODE_EXISTS")) {
      return error("DUPLICATE_DIVISION", err.message, 409);
    }
    if (err.message?.includes("IMMUTABLE")) {
      return error("IMMUTABLE_FIELD", err.message, 422);
    }
    if (err.message?.includes("CROSS_TENANT_REFERENCE") || err.message?.includes("INACTIVE_USER")) {
      return error("INVALID_DIVISION_HEAD", err.message, 422);
    }
    return handleApiError(err, "DIVISION_UPDATE_FAILED", err.message || "Failed to update division");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser) {
      return error("UNAUTHORIZED", "Authentication required", 401);
    }

    if (!requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Only Administrators can archive divisions", 403);
    }

    const { id } = await params;
    const archived = await divisionService.archiveDivision(authUser, id);

    return success({
      message: "Division successfully archived.",
      division: archived,
    });
  } catch (err: any) {
    if (err.message?.includes("ARCHIVE_RESTRICTED_ACTIVE_DEPARTMENTS") ||
        err.message?.includes("ARCHIVE_RESTRICTED_ACTIVE_USERS") ||
        err.message?.includes("ARCHIVE_RESTRICTED_ACTIVE_PROJECTS")) {
      return error("ARCHIVE_RESTRICTED_DEPENDENCIES", err.message, 409);
    }
    return handleApiError(err, "DIVISION_ARCHIVE_FAILED", err.message || "Failed to archive division");
  }
}

