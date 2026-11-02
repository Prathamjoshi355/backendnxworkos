import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { success, error } from "../../../../../utils/response";
import Candidate from "../../../../../models/Candidate";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await params;
    const query = id.startsWith("CAN-") ? { candidateId: id } : { _id: id };
    const candidate = await Candidate.findOne(query)
      .populate("offerDocumentRef")
      .populate("convertedUserId", "fullName email employeeId designation role")
      .lean();

    if (!candidate) return error("NOT_FOUND", "Candidate not found", 404);

    if (user.role !== "SUPER_ADMIN" && String(candidate.organizationId) !== String(user.organizationId)) {
      return error("FORBIDDEN", "Forbidden: Cross-organization access", 403);
    }

    return success({ candidate });
  } catch (err: any) {
    return error("FAILED", err.message, 500);
  }
}

