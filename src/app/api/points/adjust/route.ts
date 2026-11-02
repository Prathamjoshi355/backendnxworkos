import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { PointService } from "../../../../services/pointService";
import { recordAuditLog } from "../../../../services/auditLogService";
import { z } from "zod";

const adjustPointsSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  points: z.number().int(),
  reason: z.string().min(3),
});

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    // Only management/admin can adjust points
    if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only managers can adjust points" } }, { status: 403 });
    }

    const body = await request.json();
    const { userId, organizationId, points, reason } = adjustPointsSchema.parse(body);

    // Validate user has access to organization
    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== organizationId) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this organization" } }, { status: 403 });
    }

    const transaction = await PointService.adjustPoints(userId, organizationId, points, reason, String(user._id));
    await recordAuditLog({
      organizationId,
      actorId: String(user._id),
      actorRole: user.role,
      action: "POINT_ADJUSTED",
      entityType: "POINT_TRANSACTION",
      entityId: String(transaction._id),
      summary: `Adjusted ${points} points`,
      metadata: { userId, reason },
    });

    return NextResponse.json({
      success: true,
      data: { transaction },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: error.issues[0].message } }, { status: 400 });
    }

    console.error("Error adjusting points:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to adjust points" } },
      { status: 500 }
    );
  }
}
