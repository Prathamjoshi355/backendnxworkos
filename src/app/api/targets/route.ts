import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import { TargetService } from "../../../services/targetService";
import { Target } from "../../../models/Target";
import { z } from "zod";

const createTargetSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
  type: z.enum(["TASKS", "CALLS", "LEADS", "MEETINGS", "CUSTOM"]),
  title: z.string().min(3),
  targetValue: z.number().min(1),
  periodType: z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY"]),
  startDate: z.string(),
  endDate: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    // Only management/admin can create targets
    if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only managers can create targets" } }, { status: 403 });
    }

    const body = await request.json();
    const { userId, organizationId, departmentId, teamId, type, title, targetValue, periodType, startDate, endDate } = createTargetSchema.parse(body);

    // Validate user has access
    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== organizationId) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this organization" } }, { status: 403 });
    }

    const target = await TargetService.createTarget(userId, organizationId, {
      departmentId: departmentId || null,
      teamId: teamId || null,
      type,
      title,
      targetValue,
      periodType: periodType as any,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      createdBy: String(user._id),
    });

    return NextResponse.json({
      success: true,
      data: { target },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: error.issues[0].message } }, { status: 400 });
    }

    console.error("Error creating target:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to create target" } },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const organizationId = searchParams.get("organizationId");
    const userId = searchParams.get("userId");
    const status = searchParams.get("status");
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
    const query: any = { organizationId };
    if (userId) query.userId = userId;
    if (status) query.status = status;

    // If not manager, only show own targets
    if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      query.userId = user._id;
    }

    const skip = (page - 1) * limit;
    const targets = await Target.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    const total = await Target.countDocuments(query);

    return NextResponse.json({
      success: true,
      data: {
        targets,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    console.error("Error fetching targets:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to fetch targets" } },
      { status: 500 }
    );
  }
}
