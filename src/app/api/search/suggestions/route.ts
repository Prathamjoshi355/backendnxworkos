import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as searchService from "../../../../services/searchService";
import { success, error } from "../../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!searchService.isSearchAllowedForRole(user.role)) {
      return error("FORBIDDEN", "Global Search is not accessible for this role", 403);
    }

    const url = new URL(request.url);
    const q = url.searchParams.get("q") || "";

    const suggestions = await searchService.getSuggestions(q, user);
    return success({ suggestions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Suggestions failed";
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Global Search is not accessible for this role", 403);
    }
    return error("SUGGESTIONS_FAILED", message, 500);
  }
}
