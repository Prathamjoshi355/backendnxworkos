import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../../../../services/authService";
import User from "../../../../../models/User";
import leadService from "../../../../../services/leadService";
import { assignLeadValidator } from "../../../../../validators/lead";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

    const body = await request.json();

    const validationResult = assignLeadValidator.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            details: validationResult.error.flatten(),
          },
        },
        { status: 422 }
      );
    }

    const lead = await leadService.assignLead(
      {
        userId: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId?.toString(),
        departmentId: user.departmentId || undefined,
        teamId: user.teamId || undefined,
        permissions: user.permissions,
      },
      (await context.params).id,
      validationResult.data.assignedTo
    );

    return NextResponse.json({
      success: true,
      data: { lead },
    });
  } catch (error: any) {
    if (error.message === "LEAD_NOT_FOUND") {
      return NextResponse.json(
        { success: false, error: { code: "LEAD_NOT_FOUND", message: "Lead not found" } },
        { status: 404 }
      );
    }
    if (error.message === "FORBIDDEN") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Access denied" } },
        { status: 403 }
      );
    }
    if (error.message === "INVALID_ASSIGNED_USER") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_ASSIGNED_USER", message: "Assigned user is inactive or not found" } },
        { status: 400 }
      );
    }

    console.error("POST /api/leads/[id]/assign error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}
