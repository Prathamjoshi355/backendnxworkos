import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import { getControlCenterOverview } from "../../../../services/adminControlCenterService";
import { getSuperAdminControlCenterOverview } from "../../../../services/superAdminControlService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    // Section 6: Restrict Super Admin Control Center to SUPER_ADMIN / ADMIN
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return error("FORBIDDEN", "Super Admin Control Center is restricted to authorized platform administrators.", 403);
    }

    const url = new URL(request.url);
    const orgId = url.searchParams.get("organizationId") || undefined;

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    if (!isSuperAdmin && orgId && String(user.organizationId) !== String(orgId)) {
      return error("FORBIDDEN", "Cannot access Control Center of another organization", 403);
    }

    const legacyOverview = await getControlCenterOverview({ user, targetOrganizationId: orgId });
    const documentOverview = await getSuperAdminControlCenterOverview(user, orgId);

    return success({
      ...legacyOverview,
      headcount: documentOverview.headcount,
      documents: documentOverview.documents,
      registries: documentOverview.registries,
      systemHealth: documentOverview.system,
    });
  } catch (err: any) {
    if (err.message && err.message.startsWith("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    return error("FAILED", err.message, 500);
  }
}
