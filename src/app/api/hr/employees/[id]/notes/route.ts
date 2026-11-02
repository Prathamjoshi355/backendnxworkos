import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import * as hrService from "../../../../../../services/hrService";
import { success, error } from "../../../../../../utils/response";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!hrService.isHrOrAdmin(user)) {
      return error("FORBIDDEN", "Forbidden - requires HR or Admin role", 403);
    }

    const { id } = await context.params;
    const body = await request.json();

    if (!body.note || body.note.trim().length === 0) {
      return error("VALIDATION_ERROR", "Note text is required", 422);
    }

    const createdNote = await hrService.addHrNote(user, id, body.note);
    return success({ note: createdNote }, 201);
  } catch (err: any) {
    console.error("POST /api/hr/employees/[id]/notes error:", err);
    if (err.message === "EMPLOYEE_NOT_FOUND") return error("NOT_FOUND", "Employee not found", 404);
    if (err.message === "FORBIDDEN_ORGANIZATION_ACCESS") return error("FORBIDDEN", "Forbidden - cross-organization access", 403);
    return error("FAILED", err.message || "Failed to add HR note", 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    if (!hrService.isHrOrAdmin(user)) {
      return error("FORBIDDEN", "Forbidden - requires HR or Admin role", 403);
    }

    const { id } = await context.params;
    const url = new URL(request.url);
    let noteId = url.searchParams.get("noteId");

    if (!noteId) {
      try {
        const body = await request.json();
        noteId = body.noteId;
      } catch (_) {}
    }

    if (!noteId) {
      return error("VALIDATION_ERROR", "noteId is required", 422);
    }

    const res = await hrService.deleteHrNote(user, id, noteId);
    return success(res);
  } catch (err: any) {
    console.error("DELETE /api/hr/employees/[id]/notes error:", err);
    if (err.message === "EMPLOYEE_NOT_FOUND") return error("NOT_FOUND", "Employee not found", 404);
    if (err.message === "FORBIDDEN_ORGANIZATION_ACCESS") return error("FORBIDDEN", "Forbidden - cross-organization access", 403);
    return error("FAILED", err.message || "Failed to delete HR note", 500);
  }
}
