import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { getCompensationById, setCompensationStatus } from "../../../../../services/compensationService";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only admins may change compensation status" } }, { status: 403 });
    }

    const body = await request.json();
    const status = body.status;
    if (!status || !["ACTIVE", "INACTIVE", "REVISED"].includes(status)) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid status" } }, { status: 400 });
    }

    const record = await getCompensationById((await context.params).id);
    if (!record) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Compensation record not found" } }, { status: 404 });

    const result = await setCompensationStatus((await context.params).id, status, String(user._id));
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: { code: error.message || "COMPENSATION_STATUS_FAILED", message: error.message || "Unable to update compensation status" } }, { status: error.message === "COMPENSATION_NOT_FOUND" ? 404 : 400 });
  }
}
