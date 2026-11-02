import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as projectService from "../../../services/projectService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");
    const status = url.searchParams.get("status") || undefined;
    const departmentId = url.searchParams.get("departmentId") || undefined;
    const teamId = url.searchParams.get("teamId") || undefined;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (departmentId) filter.departmentId = departmentId;
    if (teamId) filter.teamId = teamId;

    const result = await projectService.listProjects(user, filter, { skip: (page - 1) * limit, limit });
    return success(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to load projects";
    return error("PROJECT_LIST_FAILED", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (["EMPLOYEE", "INTERN"].includes(user.role) && !user.permissions?.includes("project.create")) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const body = await request.json();
    if (!body.name) return error("VALIDATION_ERROR", "Project name is required", 422);

    const project = await projectService.createProject(user, body);
    return success({ project });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to create project";
    return error("PROJECT_CREATE_FAILED", message, 500);
  }
}
