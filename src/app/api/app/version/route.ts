import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getAppVersionConfig, updateAppVersionConfig } from "../../../../services/versionService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform") || undefined;
    const currentVersion = url.searchParams.get("currentVersion") || undefined;

    const data = await getAppVersionConfig(platform, currentVersion);
    return success(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to fetch version information";
    return error("VERSION_CHECK_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Only Super Admin and Admin can update version configuration", 403);
    }

    const body = await request.json();
    const updated = await updateAppVersionConfig(user, body);
    return success({ versionConfig: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to update version configuration";
    return error("VERSION_UPDATE_FAILED", message, 500);
  }
}

export async function PUT(request: Request) {
  return POST(request);
}
