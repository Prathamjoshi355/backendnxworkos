import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { PointTransaction } from "@/src/models/PointTransaction";
import { z } from "zod";

const getHistorySchema = z.object({
  organizationId: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  type: z.enum(["EARNED", "DEDUCTED", "ADJUSTED"]).optional(),
  sourceType: z.enum(["TASK", "TARGET", "MANUAL", "BONUS", "PENALTY"]).optional(),
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("20"),
});

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

    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const type = searchParams.get("type");
    const sourceType = searchParams.get("sourceType");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // Build query
    const query: any = {
      organizationId,
    };
    const userId = searchParams.get("userId");
    if (userId) query.userId = userId;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) query.userId = user._id;

    if (type) query.type = type;
    if (sourceType) query.sourceType = sourceType;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    const transactions = await PointTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await PointTransaction.countDocuments(query);

    return NextResponse.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching point history:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to fetch point history" } },
      { status: 500 }
    );
  }
}
