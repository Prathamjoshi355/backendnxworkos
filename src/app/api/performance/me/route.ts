import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { PerformanceService } from "@/src/services/performanceService";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const organizationId = searchParams.get("organizationId");
    const periodType = (searchParams.get("periodType") || "MONTHLY") as "DAILY" | "WEEKLY" | "MONTHLY";

    if (!organizationId) {
      return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "organizationId is required" } }, { status: 400 });
    }

    // Validate user has access
    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== organizationId) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this organization" } }, { status: 403 });
    }

    const performance = await PerformanceService.getCurrentPerformance(String(user._id), organizationId, periodType);

    return NextResponse.json({
      success: true,
      data: { performance },
    });
  } catch (error) {
    console.error("Error fetching performance:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to fetch performance" } },
      { status: 500 }
    );
  }
}
