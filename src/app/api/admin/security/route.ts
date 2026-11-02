import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getSecurityTelemetry } from "../../../../services/securityCenterService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Security Center requires Admin or Super Admin permission", 403);
    }

    const url = new URL(request.url);
    const requestedOrgId = url.searchParams.get("organizationId");

    // Organization isolation for Admin
    if (user.role === "ADMIN" && requestedOrgId && requestedOrgId !== String(user.organizationId)) {
      return error("FORBIDDEN", "Admin cannot access another organization's Security Center", 403);
    }

    const targetOrgId = user.role === "SUPER_ADMIN" ? requestedOrgId : String(user.organizationId);

    const data = await getSecurityTelemetry({
      organizationId: targetOrgId,
      role: user.role,
    });

    return success(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load Security Telemetry";
    return error("SECURITY_TELEMETRY_FAILED", message, 500);
  }
}
