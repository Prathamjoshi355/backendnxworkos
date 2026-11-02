import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../config/database";
import { verifyToken } from "../../../services/authService";
import { getEffectivePermissions } from "../../../middleware/auth";
import Lead from "../../../models/Lead";
import User from "../../../models/User";
import { createLeadValidator, listLeadsQueryValidator } from "../../../validators/lead";
import leadService from "../../../services/leadService";

export async function GET(request: NextRequest) {
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

    // Parse query parameters - handle both NextRequest and standard Request
    let searchParams: URLSearchParams;
    try {
      searchParams = request.nextUrl?.searchParams || new URL(request.url).searchParams;
    } catch {
      searchParams = new URL(request.url || "http://localhost").searchParams;
    }

    const filters = {
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
      pipelineStage: searchParams.get("pipelineStage") || undefined,
      priority: searchParams.get("priority") || undefined,
      assignedTo: searchParams.get("assignedTo") || undefined,
      departmentId: searchParams.get("departmentId") || undefined,
      teamId: searchParams.get("teamId") || undefined,
      source: searchParams.get("source") || undefined,
      leadType: searchParams.get("leadType") || undefined,
      followUpToday: searchParams.get("followUpToday") === "true",
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      page: parseInt(searchParams.get("page") || "1"),
      limit: parseInt(searchParams.get("limit") || "20"),
      sortBy: searchParams.get("sortBy") || undefined,
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
    };

    const effectivePermissions = getEffectivePermissions(user);

    const result = await leadService.listLeads(
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
    if (error.message === "FORBIDDEN") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Access denied" } },
        { status: 403 }
      );
    }

    console.error("GET /api/leads error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    // Validate input
    const validationResult = createLeadValidator.safeParse(body);
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

    const lead = await leadService.createLead(
      {
        userId: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId?.toString(),
        departmentId: user.departmentId || undefined,
        teamId: user.teamId || undefined,
        permissions: effectivePermissions,
      },
      validationResult.data
    );

    return NextResponse.json(
      {
        success: true,
        data: { lead },
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error.message === "FORBIDDEN") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Access denied" } },
        { status: 403 }
      );
    }
    if (error.message === "LEAD_DUPLICATE") {
      return NextResponse.json(
        { success: false, error: { code: "LEAD_DUPLICATE", message: "Lead already exists with same phone/email" } },
        { status: 409 }
      );
    }
    if (error.message === "INVALID_ASSIGNED_USER") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_ASSIGNED_USER", message: "Assigned user is inactive or not found" } },
        { status: 400 }
      );
    }

    console.error("POST /api/leads error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}
