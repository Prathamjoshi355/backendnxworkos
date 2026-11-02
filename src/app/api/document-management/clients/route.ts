import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import * as docService from "../../../../services/documentManagementService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 50;
    const page = url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!, 10) : 1;

    const result = await docService.listClientCompanies(user, { search, status, limit, page });
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
    if (!body.companyName || !body.companyName.trim()) {
      return error("VALIDATION_ERROR", "Company name is required", 422);
    }

    const client = await docService.createClientCompany(user, {
      companyName: body.companyName,
      contactPerson: body.contactPerson,
      officialEmail: body.officialEmail,
      phone: body.phone,
      registeredAddress: body.registeredAddress,
      website: body.website,
      cin: body.cin,
      gstNumber: body.gstNumber,
      panNumber: body.panNumber,
      notes: body.notes,
    });

    return success({ client }, 201);
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

