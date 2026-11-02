import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as hrService from "../../../../services/hrService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!hrService.isHrOrAdmin(user)) {
      return error("FORBIDDEN", "HR Operations access requires HR or Admin role", 403);
    }

    const url = new URL(request.url);
    const orgParam = url.searchParams.get("organizationId") || undefined;

    const data = await hrService.getHrOverview(user, orgParam);
    return success({ overview: data });
  } catch (err: any) {
    console.error("GET /api/hr/overview error:", err);
    return error("FAILED", err.message || "Failed to load HR overview", 500);
  }
}
