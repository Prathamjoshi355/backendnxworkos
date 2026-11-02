import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import { MASTER_PERMISSION_CATALOGUE, ROLE_DEFAULT_PERMISSIONS } from "../../../../services/centralPermissionService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    return success({
      catalog: MASTER_PERMISSION_CATALOGUE,
      total: MASTER_PERMISSION_CATALOGUE.length,
      roleDefaults: ROLE_DEFAULT_PERMISSIONS,
    });
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

