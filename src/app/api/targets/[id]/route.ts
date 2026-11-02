import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { TargetService } from "../../../../services/targetService";
import { Target } from "../../../../models/Target";
import { z } from "zod";

const updateTargetSchema = z.object({
  title: z.string().min(3).optional(),
  targetValue: z.number().min(1).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "ACHIEVED", "EXPIRED", "CANCELLED"]).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "ACHIEVED", "EXPIRED", "CANCELLED"]),
});

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    const target = await Target.findById((await context.params).id).lean();
    if (!target) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Target not found" } }, { status: 404 });
    }

    // Validate access
    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== target.organizationId.toString()) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this target" } }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      data: { target },
    });
  } catch (error) {
    console.error("Error fetching target:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to fetch target" } },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    const target = await Target.findById((await context.params).id);
    if (!target) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Target not found" } }, { status: 404 });
    }

    // Only managers can update targets
    if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only managers can update targets" } }, { status: 403 });
    }

    // Validate access
    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== target.organizationId.toString()) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this target" } }, { status: 403 });
    }

    const body = await request.json();
    const updates = updateTargetSchema.parse(body);

    const updated = await TargetService.updateTarget((await context.params).id, updates);

    return NextResponse.json({
      success: true,
      data: { target: updated },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: error.issues[0].message } }, { status: 400 });
    }

    console.error("Error updating target:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to update target" } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    }

    const target = await Target.findById((await context.params).id);
    if (!target) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Target not found" } }, { status: 404 });
    }

    // Only managers can update status
    if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only managers can update targets" } }, { status: 403 });
    }

    // Validate access
    if (user.role !== "SUPER_ADMIN" && String(user.organizationId || "") !== target.organizationId.toString()) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "No access to this target" } }, { status: 403 });
    }

    const body = await request.json();
    const { status } = updateStatusSchema.parse(body);

    const updated = await TargetService.updateTargetStatus((await context.params).id, status);

    return NextResponse.json({
      success: true,
      data: { target: updated },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: error.issues[0].message } }, { status: 400 });
    }

    console.error("Error updating target status:", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to update target status" } },
      { status: 500 }
    );
  }
}
