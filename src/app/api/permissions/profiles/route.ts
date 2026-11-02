import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import PermissionProfile from "../../../../models/PermissionProfile";
import { ensurePredefinedPermissionProfiles } from "../../../../services/centralPermissionService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    await ensurePredefinedPermissionProfiles();

    const url = new URL(request.url);
    const departmentCode = url.searchParams.get("departmentCode");

    const filter: any = {
      $or: [{ organizationId: null }, { organizationId: user.organizationId }],
      status: "ACTIVE",
    };
    if (departmentCode) {
      filter.departmentCode = departmentCode.toUpperCase();
    }

    const profiles = await PermissionProfile.find(filter).sort({ departmentCode: 1, name: 1 });
    return success({ profiles, total: profiles.length });
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return error("FORBIDDEN", "Only administrators can configure permission profiles", 403);
    }

    const body = await request.json();
    if (!body.name || !body.code || !Array.isArray(body.permissions)) {
      return error("VALIDATION_ERROR", "name, code, and permissions array are required", 422);
    }

    const code = body.code.toUpperCase().trim();

    const profile = await PermissionProfile.create({
      name: body.name.trim(),
      code,
      departmentCode: body.departmentCode ? body.departmentCode.toUpperCase().trim() : null,
      targetRole: body.targetRole || null,
      description: body.description?.trim() || null,
      permissions: body.permissions,
      isPredefined: false,
      organizationId: user.organizationId,
      status: "ACTIVE",
    });

    return success({ profile }, 201);
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

