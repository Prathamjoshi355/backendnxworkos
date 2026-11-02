import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import DocumentCategory from "../../../../models/DocumentCategory";
import { ensurePredefinedDocumentCatalog } from "../../../../services/documentManagementService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    await ensurePredefinedDocumentCatalog();

    const categories = await DocumentCategory.find({
      $or: [{ organizationId: null }, { organizationId: user.organizationId }],
      status: "ACTIVE",
    }).sort({ isPredefined: -1, name: 1 });

    return success({ categories, total: categories.length });
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    // Only Admin or Super Admin can create custom categories
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return error("FORBIDDEN", "Only administrators can create document categories", 403);
    }

    const body = await request.json();
    if (!body.name || !body.name.trim()) {
      return error("VALIDATION_ERROR", "Category name is required", 422);
    }

    const code = (body.code || body.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")).trim();

    const category = await DocumentCategory.create({
      name: body.name.trim(),
      code,
      description: body.description?.trim() || null,
      isPredefined: false,
      organizationId: user.organizationId,
      status: "ACTIVE",
    });

    return success({ category }, 201);
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

