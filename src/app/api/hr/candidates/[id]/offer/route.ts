import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import { success, error } from "../../../../../../utils/response";
import * as candidateService from "../../../../../../services/candidateOfferService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const allowedRoles = ["SUPER_ADMIN", "ADMIN", "DIVISION_ADMIN", "HR"];
    if (!allowedRoles.includes(user.role)) {
      return error("FORBIDDEN", "Forbidden: HR or Admin role required", 403);
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.action === "SEND") {
      const candidate = await candidateService.sendOfferToCandidate(user, id);
      return success({ candidate, message: "Offer sent with 7-day acceptance deadline" });
    }

    // Default: generate offer document
    if (!body.offerType) {
      return error("VALIDATION_ERROR", "offerType ('EMPLOYEE_OFFER' or 'INTERNSHIP_OFFER') is required", 422);
    }

    const result = await candidateService.generateOfferForCandidate(user, id, {
      offerType: body.offerType,
      compensationAmount: body.compensationAmount,
      joiningDate: body.joiningDate,
      notes: body.notes,
    });

    return success(result, 201);
  } catch (err: any) {
    if (err.message.startsWith("CANDIDATE_NOT_FOUND")) {
      return error("NOT_FOUND", err.message, 404);
    }
    if (err.message.startsWith("VALIDATION_ERROR") || err.message.startsWith("INVALID_")) {
      return error("VALIDATION_ERROR", err.message, 422);
    }
    return error("FAILED", err.message, 500);
  }
}

