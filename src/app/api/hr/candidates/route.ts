import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import Candidate from "../../../../models/Candidate";
import * as candidateService from "../../../../services/candidateOfferService";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const allowedRoles = ["SUPER_ADMIN", "ADMIN", "DIVISION_ADMIN", "HR", "MANAGER"];
    if (!allowedRoles.includes(user.role)) {
      return error("FORBIDDEN", "Forbidden: HR or Admin role required", 403);
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");
    const divisionId = url.searchParams.get("divisionId");
    const departmentId = url.searchParams.get("departmentId");

    const query: any = { organizationId: user.organizationId };

    if (user.role === "DIVISION_ADMIN" && user.divisionId) {
      query.divisionId = user.divisionId;
    } else if (divisionId) {
      query.divisionId = divisionId;
    }

    if (departmentId) query.departmentId = departmentId;
    if (status) query.status = status;

    if (search) {
      const s = search.trim();
      query.$or = [
        { fullName: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { candidateId: { $regex: s, $options: "i" } },
        { designation: { $regex: s, $options: "i" } },
        { offerDocumentId: { $regex: s, $options: "i" } },
      ];
    }

    const candidates = await Candidate.find(query)
      .sort({ createdAt: -1 })
      .populate("offerDocumentRef", "documentId title documentTypeCode status attachments")
      .lean();

    return success({ candidates, total: candidates.length });
  } catch (err: any) {
    return error("FAILED", err.message || "Failed to list candidates", 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const allowedRoles = ["SUPER_ADMIN", "ADMIN", "DIVISION_ADMIN", "HR"];
    if (!allowedRoles.includes(user.role)) {
      return error("FORBIDDEN", "Forbidden: HR or Admin role required", 403);
    }

    const body = await request.json();
    if (!body.fullName || !body.fullName.trim()) {
      return error("VALIDATION_ERROR", "Candidate fullName is required", 422);
    }
    if (!body.email || !body.email.trim()) {
      return error("VALIDATION_ERROR", "Candidate email is required", 422);
    }
    if (!body.designation || !body.designation.trim()) {
      return error("VALIDATION_ERROR", "Candidate designation is required", 422);
    }

    const candidate = await candidateService.createCandidate(user, body);
    return success({ candidate }, 201);
  } catch (err: any) {
    return error("FAILED", err.message || "Failed to create candidate", 500);
  }
}
