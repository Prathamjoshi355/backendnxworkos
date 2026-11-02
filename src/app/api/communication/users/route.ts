import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as communicationService from "../../../../services/communicationService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || url.searchParams.get("q") || "";

    const users = await communicationService.searchCollaborators(user, search);
    return success({ users });
  } catch (err: any) {
    console.error("GET /api/communication/users error:", err);
    return error("FAILED", err.message || "Failed to search collaborators", 500);
  }
}
