import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as documentService from "../../../../services/documentService";
import User from "../../../../models/User";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const requestedUserId = url.searchParams.get("userId") || String(user._id || user.id);

    const isSelf = requestedUserId === String(user._id || user.id);
    const isPrivileged = ["SUPER_ADMIN", "ADMIN", "HR"].includes(user.role);

    if (!isSelf && !isPrivileged) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const targetUser = await User.findById(requestedUserId).lean();
    if (!targetUser) return error("NOT_FOUND", "User not found", 404);

    if (user.role !== "SUPER_ADMIN" && targetUser.organizationId && String(targetUser.organizationId) !== String(user.organizationId)) {
      return error("FORBIDDEN", "Forbidden - user belongs to another organization", 403);
    }

    const checklist = await documentService.getDocumentChecklist(requestedUserId, targetUser.employmentType || "EMPLOYEE");
    return success({ checklist, user: { id: targetUser._id, fullName: targetUser.fullName, employmentType: targetUser.employmentType } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to retrieve document checklist";
    return error("CHECKLIST_FETCH_FAILED", message, 500);
  }
}
