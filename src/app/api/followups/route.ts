import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../../services/authService";
import { getEffectivePermissions } from "../../../middleware/auth";
import User from "../../../models/User";
import FollowUp from "../../../models/FollowUp";
import leadService from "../../../services/leadService";
import { completeFollowUpValidator } from "../../../validators/lead";

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Missing token" } }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid token" } }, { status: 401 });
    }

    const user = await User.findById(payload.sub).lean();
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } }, { status: 404 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const filters = {
      status: searchParams.get("status") || undefined,
      assignedTo: searchParams.get("assignedTo") || undefined,
      today: searchParams.get("today") === "true",
      overdue: searchParams.get("overdue") === "true",
      page: parseInt(searchParams.get("page") || "1"),
      limit: parseInt(searchParams.get("limit") || "20"),
    };

    const effectivePermissions = getEffectivePermissions(user);

    const result = await leadService.getFollowUps(
      {
        userId: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId?.toString(),
        departmentId: user.departmentId || undefined,
        teamId: user.teamId || undefined,
        permissions: effectivePermissions,
      },
      filters
    );

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("GET /api/followups error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}
