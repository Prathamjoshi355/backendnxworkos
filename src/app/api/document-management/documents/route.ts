import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import * as docService from "../../../../services/documentManagementService";
import DocumentType from "../../../../models/DocumentType";
import DocumentCategory from "../../../../models/DocumentCategory";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || undefined;
    const categoryId = url.searchParams.get("categoryId") || undefined;
    const documentTypeId = url.searchParams.get("documentTypeId") || undefined;
    const documentTypeCode = url.searchParams.get("documentTypeCode") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const confidentialityLevel = url.searchParams.get("confidentialityLevel") || undefined;
    const clientCompanyId = url.searchParams.get("clientCompanyId") || undefined;
    const employeeId = url.searchParams.get("employeeId") || undefined;
    const projectId = url.searchParams.get("projectId") || undefined;
    const divisionId = url.searchParams.get("divisionId") || undefined;
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const isLegacyImport =
      url.searchParams.get("isLegacyImport") === "true"
        ? true
        : url.searchParams.get("isLegacyImport") === "false"
        ? false
        : undefined;
    const attachmentStatus = url.searchParams.get("attachmentStatus") || undefined;
    const pendingUploadsOnly = url.searchParams.get("pendingUploadsOnly") === "true";
    const isArchived = url.searchParams.get("isArchived") === "true";
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 50;
    const page = url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!, 10) : 1;

    const result = await docService.listDocuments(user, {
      search,
      categoryId,
      documentTypeId,
      documentTypeCode,
      status,
      confidentialityLevel,
      clientCompanyId,
      employeeId,
      projectId,
      divisionId,
      departmentId,
      isLegacyImport,
      attachmentStatus,
      pendingUploadsOnly,
      isArchived,
      startDate,
      endDate,
      limit,
      page,
    });

    return success(result);
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const body = await request.json();

    // Prevent client ID overrides (Section 14 & 16)
    if (body.documentId) {
      return error("VALIDATION_ERROR", "CLIENT_OVERRIDE_PROHIBITED: Clients cannot choose or override official Document IDs.", 422);
    }
    if (body.cin && body.cin !== docService.OFFICIAL_COMPANY_CIN) {
      return error("VALIDATION_ERROR", "CLIENT_OVERRIDE_PROHIBITED: Clients cannot override the official company CIN.", 422);
    }
    if (body.typeCode && body.typeCode.includes("0")) {
      return error("VALIDATION_ERROR", "INVALID_DOCUMENT_TYPE_CODE: Zero is strictly prohibited in document type codes.", 422);
    }

    if (!body.title || !body.title.trim()) {
      return error("VALIDATION_ERROR", "Document title is required", 422);
    }

    // Resolve category and document type if passed by key/code/name
    let categoryId = body.categoryId;
    let documentTypeId = body.documentTypeId;
    let resolvedTypeCode = body.typeCode || body.documentTypeCode;

    if (!documentTypeId && body.documentType) {
      try {
        resolvedTypeCode = docService.getDocumentTypeCode(body.documentType);
      } catch (e: any) {
        return error("VALIDATION_ERROR", e.message, 422);
      }
    }

    if (resolvedTypeCode && !documentTypeId) {
      const dt = await DocumentType.findOne({ code: resolvedTypeCode });
      if (dt) {
        documentTypeId = dt._id;
        if (!categoryId && dt.categoryId) categoryId = dt.categoryId;
      }
    }

    if (!categoryId && body.categoryCode) {
      const cat = await DocumentCategory.findOne({ code: body.categoryCode });
      if (cat) categoryId = cat._id;
    }

    // Auto-resolve category if not provided by user (Category is no longer mandatory user-facing input)
    if (!categoryId) {
      const defaultCat = await DocumentCategory.findOne({ status: "ACTIVE" });
      if (defaultCat) categoryId = defaultCat._id;
    }

    if (!documentTypeId && !resolvedTypeCode) {
      return error("VALIDATION_ERROR", "Document type is required", 422);
    }

    const doc = await docService.createDocument(user, {
      ...body,
      categoryId,
      documentTypeId,
      typeCode: resolvedTypeCode,
    });

    return success({ document: doc }, 201);
  } catch (err: any) {
    if (err.message.startsWith("INVALID_") || err.message.startsWith("CLIENT_OVERRIDE_PROHIBITED") || err.message.startsWith("UNSUPPORTED_")) {
      return error("VALIDATION_ERROR", err.message, 422);
    }
    if (err.message.startsWith("LIVE_ALLOCATION_DISABLED") || err.message.startsWith("FORBIDDEN")) {
      return error("FORBIDDEN", err.message, 403);
    }
    return error("FAILED", err.message, 500);
  }
}
