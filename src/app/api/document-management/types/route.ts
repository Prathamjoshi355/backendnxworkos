import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import DocumentType from "../../../../models/DocumentType";
import DocumentCategory from "../../../../models/DocumentCategory";
import { ensurePredefinedDocumentCatalog } from "../../../../services/documentManagementService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    await ensurePredefinedDocumentCatalog();

    const url = new URL(request.url);
    const categoryId = url.searchParams.get("categoryId");

    const filter: any = {
      $or: [{ organizationId: null }, { organizationId: user.organizationId }],
      status: "ACTIVE",
    };
    if (categoryId) filter.categoryId = categoryId;

    const types = await DocumentType.find(filter)
      .populate("categoryId", "name code")
      .sort({ code: 1 });

    return success({ types, total: types.length });
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    // Only SUPER_ADMIN controls the master document type registry (Section 3.3)
    if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
      return error("FORBIDDEN", "Only administrators can register document types", 403);
    }

    const body = await request.json();
    if (!body.name || !body.name.trim()) {
      return error("VALIDATION_ERROR", "Document type name is required", 422);
    }
    if (!body.categoryId) {
      return error("VALIDATION_ERROR", "Category ID is required", 422);
    }
    if (!body.code || !body.code.trim()) {
      return error("VALIDATION_ERROR", "Three-digit document type code is required", 422);
    }

    const code = body.code.trim();

    // STRICT RULES (Section 3.3):
    // 1. Exactly three digits
    // 2. Every digit must be between 1 and 9 (zero is prohibited in every position)
    // 3. No alphabetic characters
    if (!/^[1-9]{3}$/.test(code)) {
      return error(
        "INVALID_CODE",
        `Invalid Document Type Code '${code}': Code must be exactly three numeric digits between 1-9 with no zero (e.g. 512, 749, 286). Zero is strictly prohibited.`,
        422
      );
    }

    // 4. Code uniqueness check across entire system (even archived types do not release code)
    const existingCode = await DocumentType.findOne({ code });
    if (existingCode) {
      return error(
        "DUPLICATE_CODE",
        `Document Type Code '${code}' is already registered for '${existingCode.name}'. Codes are permanently immutable and cannot be reused.`,
        409
      );
    }

    const category = await DocumentCategory.findById(body.categoryId);
    if (!category) {
      return error("NOT_FOUND", "Document category not found", 404);
    }

    const docType = await DocumentType.create({
      name: body.name.trim(),
      code,
      categoryId: category._id,
      hasFinancials: Boolean(body.hasFinancials),
      description: body.description?.trim() || null,
      isPredefined: user.role === "SUPER_ADMIN" && !user.organizationId,
      organizationId: user.organizationId || null,
      status: "ACTIVE",
    });

    return success({ type: docType }, 201);
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

