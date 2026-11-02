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
    const body = await request.json();

    if (!body.decision || !["APPROVE", "REJECT"].includes(body.decision)) {
      return error("VALIDATION_ERROR", "decision ('APPROVE' or 'REJECT') is required", 422);
    }

    const candidate = await candidateService.reviewOfferSubmission(
      user,
      id,
      body.decision,
      body.notes
    );

    return success({ candidate });
  } catch (err: any) {
    if (err.message.startsWith("CANDIDATE_NOT_FOUND")) {
      return error("NOT_FOUND", err.message, 404);
    }
    return error("FAILED", err.message, 500);
  }
}

