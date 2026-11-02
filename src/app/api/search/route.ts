import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as searchService from "../../../services/searchService";
import { success, error } from "../../../utils/response";

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
    const type = url.searchParams.get("type") || undefined;
    const page = Number(url.searchParams.get("page")) || 1;
    const limit = Number(url.searchParams.get("limit")) || 20;
    const from = url.searchParams.get("from") || undefined;
    const to = url.searchParams.get("to") || undefined;

    const results = await searchService.globalSearch(q, user, {
      type,
      page,
      limit,
      from,
      to,
    });

    return success(results);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Search failed";
    if (message === "FORBIDDEN") {
      return error("FORBIDDEN", "Global Search is not accessible for this role", 403);
    }
    return error("SEARCH_FAILED", message, 500);
  }
}
