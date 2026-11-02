import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { PerformanceSnapshot } from "@/src/models/PerformanceSnapshot";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const organizationId = searchParams.get("organizationId");
    const periodType = searchParams.get("periodType");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    if (!organizationId) {
      return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "organizationId is required" } }, { status: 400 });
    }

    // Validate access
    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== organizationId) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this organization" } }, { status: 403 });
    }

    // Build query
    const query: any = {
      organizationId,
    };
    const userId = searchParams.get("userId");
    if (userId) query.userId = userId;
    if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") query.userId = user._id;

    if (periodType) query.periodType = periodType;

    const skip = (page - 1) * limit;
    const snapshots = await PerformanceSnapshot.find(query)
      .sort({ periodStart: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await PerformanceSnapshot.countDocuments(query);

    return NextResponse.json({
      success: true,
      data: {
        snapshots,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching performance history:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to fetch performance history" } },
      { status: 500 }
    );
  }
}
