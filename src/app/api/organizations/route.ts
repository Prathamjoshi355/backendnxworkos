import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import { OrganizationCreateSchema } from "../../../validators/organization";
import * as orgService from "../../../services/organizationService";
import { recordAuditLog } from "../../../services/auditLogService";
import { success, error } from "../../../utils/response";

export async function POST(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (user.role !== "SUPER_ADMIN") {
    return error("FORBIDDEN", "Only Super Admin can create organizations", 403);
  }

  const body = await request.json();
  const parsed = OrganizationCreateSchema.safeParse(body);
  if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

  try {
    const created = await orgService.createOrganization(parsed.data);
    await recordAuditLog({
      organizationId: String(created._id),
      actorId: String(user._id),
      actorRole: user.role,
      action: "ORGANIZATION_CREATED",
      entityType: "ORGANIZATION",
      entityId: String(created._id),
      summary: `Created organization ${created.name}`,
      metadata: { name: created.name, email: created.email },
    });
    return success({ organization: created }, 201);
  } catch (err: any) {
    console.error(err);
    return error("INTERNAL_ERROR", "Unable to create organization", 500);
  }
}

export async function GET(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
  if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
    return error("FORBIDDEN", "Forbidden", 403);
  }

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || "1");
  const limit = Number(url.searchParams.get("limit") || "50");
  const search = url.searchParams.get("search") || undefined;
  const status = url.searchParams.get("status") || undefined;

  const filter: Record<string, unknown> = {};

  if (user.role === "ADMIN") {
    filter._id = user.organizationId;
  }

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.name = { $regex: search, $options: "i" };
  }

  const res = await orgService.listOrganizations(filter, { skip: (page - 1) * limit, limit });
  return success(res);
}
