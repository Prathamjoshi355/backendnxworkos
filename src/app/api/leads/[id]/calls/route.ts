import { NextResponse } from "next/server";
import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, getEffectivePermissions } from "../../../../../middleware/auth";
import * as crmCallService from "../../../../../services/crmCallService";
import * as leadService from "../../../../../services/leadService";
import { error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

    const { id } = await context.params;
    const permissions = getEffectivePermissions(user);
    const calls = await leadService.getCallHistory(
      {
        userId: String(user._id),
        role: user.role,
        organizationId: String(user.organizationId),
        departmentId: user.departmentId || undefined,
        teamId: user.teamId || undefined,
        permissions,
      },
      id
    );

    return NextResponse.json({ success: true, data: { calls } }, { status: 200 });
  } catch (err: any) {
    if (err.message === "FORBIDDEN") return error("FORBIDDEN", "Access denied", 403);
    if (err.message === "LEAD_NOT_FOUND") return error("LEAD_NOT_FOUND", "Lead not found", 404);
    return error("INTERNAL_ERROR", err.message || "Failed to fetch calls", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await context.params;
  const body = await request.json();

  try {
    const result = await crmCallService.recordCall({
      organizationId: String(user.organizationId),
      leadId: id,
      employeeId: String(user._id),
      outcome: body.outcome,
      notes: body.notes,
      duration: body.duration,
    });
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (err: any) {
    return error("CALL_RECORD_FAILED", err.message || "Failed to record call attempt", 500);
  }
}
