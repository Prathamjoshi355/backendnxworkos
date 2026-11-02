import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { verifyToken } from "../../../../services/authService";
import { getEffectivePermissions } from "../../../../middleware/auth";
import Lead from "../../../../models/Lead";
import User from "../../../../models/User";
import CallLog from "../../../../models/CallLog";
import leadService from "../../../../services/leadService";
import { updateLeadValidator, logCallValidator } from "../../../../validators/lead";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
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

    const effectivePermissions = getEffectivePermissions(user);

    const lead = await leadService.getLead(
      {
        userId: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId?.toString(),
        departmentId: user.departmentId || undefined,
        teamId: user.teamId || undefined,
        permissions: effectivePermissions,
      },
      (await context.params).id
    );

    // Fetch call count and last call
    const calls = await CallLog.find({ leadId: lead._id }).sort({ createdAt: -1 }).limit(1).lean();

    return NextResponse.json({
      success: true,
      data: {
        lead: {
          ...lead,
          callCount: lead.callCount || 0,
          lastCall: calls[0] || null,
        },
      },
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

    console.error("GET /api/leads/[id] error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
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

    const validationResult = updateLeadValidator.safeParse(body);
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

    const lead = await leadService.updateLead(
      {
        userId: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId?.toString(),
        departmentId: user.departmentId || undefined,
        teamId: user.teamId || undefined,
        permissions: effectivePermissions,
      },
      (await context.params).id,
      validationResult.data as any
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

    console.error("PATCH /api/leads/[id] error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}
