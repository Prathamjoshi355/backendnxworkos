import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { PointService } from "@/src/services/pointService";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const organizationId = searchParams.get("organizationId");

    if (!organizationId) {
      return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "organizationId is required" } }, { status: 400 });
    }

    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== organizationId) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this organization" } }, { status: 403 });
    }

    let targetUserId = searchParams.get("userId") || String(user._id);
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role)) {
      targetUserId = String(user._id);
    } else if (targetUserId !== String(user._id) && (user.role === "MANAGER" || user.role === "TEAM_LEADER")) {
      const { getManagementScope } = await import("../../../../utils/scopeHelper");
      const scope = await getManagementScope(user);
      if (!scope.scopedUserIds.includes(targetUserId)) {
        return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
      }
    }

    const summary = await PointService.getPointSummary(targetUserId, organizationId);

    return NextResponse.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Error fetching point summary:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to fetch point summary" } },
      { status: 500 }
    );
  }
}
