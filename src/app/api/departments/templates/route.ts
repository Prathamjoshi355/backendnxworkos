import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import * as deptTemplateService from "../../../../services/departmentTemplateService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const templates = await deptTemplateService.listDepartmentTemplates();
    return success({ templates, total: templates.length });
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return error("FORBIDDEN", "Only administrators can enable generic departments", 403);
    }

    const body = await request.json();
    if (!body.templateCode) {
      return error("VALIDATION_ERROR", "templateCode is required", 422);
    }

    const dept = await deptTemplateService.enableGenericDepartmentForOrg(user, body.templateCode, {
      divisionId: body.divisionId,
      isCentral: body.isCentral,
      customName: body.customName,
      departmentHeadId: body.departmentHeadId,
    });

    return success({ department: dept }, 201);
  } catch (err: any) {
    if (err.message.startsWith("TEMPLATE_NOT_FOUND")) {
      return error("NOT_FOUND", err.message, 404);
    }
    return error("FAILED", err.message, 500);
  }
}

