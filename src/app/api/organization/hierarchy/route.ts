import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getOrganizationHierarchy } from "../../../../services/hierarchyService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const targetOrgId = url.searchParams.get("organizationId") || undefined;

    const hierarchy = await getOrganizationHierarchy(user, targetOrgId);
    return success(hierarchy);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load organizational hierarchy";
    if (message === "FORBIDDEN_ORG_MISMATCH") {
      return error("FORBIDDEN", "Cross-organization access is not allowed.", 403);
    }
    if (message === "ORG_NOT_FOUND") {
      return error("NOT_FOUND", "Organization not found", 404);
    }
    return error("HIERARCHY_FETCH_FAILED", message, 500);
  }
}
