import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import * as settingService from "../../../services/settingService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Settings require Admin or Super Admin permission", 403);
    }

    const url = new URL(request.url);
    const category = url.searchParams.get("category") || undefined;
    const reqOrgId = url.searchParams.get("organizationId");

    if (user.role === "ADMIN" && reqOrgId && reqOrgId !== String(user.organizationId)) {
      return error("FORBIDDEN", "Admin cannot view another organization's settings", 403);
    }

    const targetOrgId = user.role === "SUPER_ADMIN" ? (reqOrgId || String(user.organizationId || "")) : String(user.organizationId);

    const data = await settingService.getSystemSettings(targetOrgId, category);
    return success(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load settings";
    return error("SETTINGS_FAILED", message, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const body = await request.json();
    if (!body.key || body.value === undefined) {
      return error("VALIDATION_ERROR", "Key and value are required", 422);
    }

    if (user.role === "ADMIN" && body.organizationId && String(body.organizationId) !== String(user.organizationId)) {
      return error("FORBIDDEN", "Admin cannot update another organization's settings", 403);
    }

    const targetOrgId = user.role === "SUPER_ADMIN"
      ? (body.organizationId ? String(body.organizationId) : String(user.organizationId || ""))
      : String(user.organizationId);

    const updated = await settingService.updateSystemSetting(targetOrgId, user, body.key, body.value, body.category || "ORGANIZATION");
    return success({ setting: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to update setting";
    return error("SETTING_UPDATE_FAILED", message, 500);
  }
}
