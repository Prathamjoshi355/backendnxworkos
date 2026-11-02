import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import * as docService from "../../../../services/documentManagementService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    // Restricted to SUPER_ADMIN (Section 3.5)
    if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
      return error("FORBIDDEN", "Only Super Admin can inspect document allocation control", 403);
    }

    const url = new URL(request.url);
    const orgId = url.searchParams.get("organizationId") || user.organizationId;
    if (!orgId) {
      return error("VALIDATION_ERROR", "Organization ID required", 422);
    }

    const control = await docService.getOrCreateAllocationControl(orgId);
    return success({ allocationControl: control });
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    // Section 3.5: "Configurable only by SUPER_ADMIN... Normal ADMIN, DIVISION_ADMIN, MANAGER, TEAM_LEADER and EMPLOYEE must not be able to modify the live allocation counter."
    if (user.role !== "SUPER_ADMIN") {
      return error("FORBIDDEN", "Only SUPER_ADMIN can configure Document Allocation Control.", 403);
    }

    const body = await request.json();
    const orgId = body.organizationId || user.organizationId;
    if (!orgId) {
      return error("VALIDATION_ERROR", "Organization ID required", 422);
    }

    const control = await docService.configureAllocationControl(user, orgId, {
      liveAllocationEnabled: body.liveAllocationEnabled,
      startingAllocationValue: body.startingAllocationValue,
    });

    return success({ allocationControl: control });
  } catch (err: any) {
    if (err.message.startsWith("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    if (err.message.startsWith("INVALID_")) {
      return error("VALIDATION_ERROR", err.message, 422);
    }
    return error("FAILED", err.message, 500);
  }
}

