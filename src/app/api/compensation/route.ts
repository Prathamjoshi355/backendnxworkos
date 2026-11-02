import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest, requireRole } from "../../../middleware/auth";
import { createCompensation, getCurrentCompensationForUser, getUserCompensationForAdmin, updateCompensation } from "../../../services/compensationService";
import User from "../../../models/User";
import Compensation from "../../../models/Compensation";

const compensationSchema = z.object({
  userId: z.string().min(1),
  compensationType: z.enum(["SALARY", "STIPEND"]).optional(),
  baseAmount: z.number().min(0),
  currency: z.string().default("INR"),
  payFrequency: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  effectiveFrom: z.string().min(1),
  reason: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const organizationId = searchParams.get("organizationId") || user.organizationId;

    if (userId) {
      if (String(user._id) !== String(userId) && !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
        return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
      }
      const items = await getUserCompensationForAdmin(userId);
      return NextResponse.json({ success: true, data: items });
    }

    if (requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      const items = await Compensation.find(organizationId ? { organizationId } : {}).sort({ effectiveFrom: -1 }).limit(100).lean();
      return NextResponse.json({ success: true, data: { items, total: items.length } });
    }

    const current = await getCurrentCompensationForUser(String(user._id));
    return NextResponse.json({ success: true, data: current });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: { code: "COMPENSATION_FETCH_FAILED", message: error.message || "Unable to fetch compensation" } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only admins can create compensation records" } }, { status: 403 });
    }

    const body = await request.json();
    const parsed = compensationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid compensation payload" } }, { status: 400 });
    }

    const targetUser = await User.findById(parsed.data.userId).lean();
    if (!targetUser) return NextResponse.json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } }, { status: 404 });

    const result = await createCompensation({
      userId: parsed.data.userId,
      organizationId: String(targetUser.organizationId || user.organizationId || ""),
      employmentType: targetUser.employmentType,
      compensationType: parsed.data.compensationType,
      baseAmount: parsed.data.baseAmount,
      currency: parsed.data.currency,
      payFrequency: parsed.data.payFrequency,
      effectiveFrom: parsed.data.effectiveFrom,
      createdBy: String(user._id),
      reason: parsed.data.reason,
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error: any) {
    const code = error.message || "COMPENSATION_CREATE_FAILED";
    const status = code === "DUPLICATE_ACTIVE_COMPENSATION" ? 409 : code === "USER_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ success: false, error: { code, message: error.message || "Unable to create compensation" } }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Only admins can update compensation records" } }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "id is required" } }, { status: 400 });

    const body = await request.json();
    const result = await updateCompensation(id, body, String(user._id));
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === "COMPENSATION_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ success: false, error: { code: error.message || "COMPENSATION_UPDATE_FAILED", message: error.message || "Unable to update compensation" } }, { status });
  }
}
