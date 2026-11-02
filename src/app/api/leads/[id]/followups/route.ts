import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../../../../services/authService";
import { getEffectivePermissions } from "../../../../../middleware/auth";
import User from "../../../../../models/User";
import leadService from "../../../../../services/leadService";
import { createFollowUpValidator } from "../../../../../validators/lead";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

    // For lead-specific follow-ups, we'll just get them via the general endpoint
    // This route could list follow-ups for a specific lead
    return NextResponse.json({
      success: true,
      data: { followUps: [] },
    });
  } catch (error: any) {
    console.error("GET /api/leads/[id]/followups error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}

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

    const validationResult = createFollowUpValidator.safeParse(body);
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

    const effectivePermissions = getEffectivePermissions(user);

    const followUp = await leadService.createFollowUp(
      {
        userId: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId?.toString(),
        departmentId: user.departmentId || undefined,
        teamId: user.teamId || undefined,
        permissions: effectivePermissions,
      },
      (await context.params).id,
      {
        scheduledAt: new Date(validationResult.data.scheduledAt),
        reason: validationResult.data.reason,
        notes: validationResult.data.notes,
      }
    );

    return NextResponse.json(
      {
        success: true,
        data: { followUp },
      },
      { status: 201 }
    );
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

    console.error("POST /api/leads/[id]/followups error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}
