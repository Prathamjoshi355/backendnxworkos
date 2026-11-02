import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { getCompensationById, updateCompensation } from "../../../../services/compensationService";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    const record = await getCompensationById((await context.params).id);
    if (!record) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Compensation record not found" } }, { status: 404 });

    if (String(user._id) !== String(record.userId) && !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: record });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: { code: "COMPENSATION_FETCH_FAILED", message: error.message || "Unable to fetch compensation" } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only admins may revise compensation" } }, { status: 403 });
    }

    const body = await request.json();
    const result = await updateCompensation((await context.params).id, body, String(user._id));
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: { code: error.message || "COMPENSATION_UPDATE_FAILED", message: error.message || "Unable to update compensation" } }, { status: error.message === "COMPENSATION_NOT_FOUND" ? 404 : 400 });
  }
}
