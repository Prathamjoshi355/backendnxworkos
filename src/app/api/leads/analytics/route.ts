import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../../../services/authService";
import User from "../../../../models/User";
import Lead from "../../../../models/Lead";
import FollowUp from "../../../../models/FollowUp";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
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

    // Build query based on scope
    const query: any = {};
    const orgIdStr = String(user.organizationId || "");

    if (user.role === "SUPER_ADMIN") {
      if (orgIdStr) query.organizationId = new mongoose.Types.ObjectId(orgIdStr);
    } else if (user.role === "ADMIN") {
      if (orgIdStr) query.organizationId = new mongoose.Types.ObjectId(orgIdStr);
      if (user.departmentId) {
        query.departmentId = user.departmentId;
      }
    } else if (user.role === "TEAM_LEADER" || user.role === "MANAGER") {
      if (user.teamId) {
        query.teamId = user.teamId;
      }
    } else {
      query.assignedTo = new mongoose.Types.ObjectId(String(user._id));
    }

    // Get analytics
    const [
      totalLeads,
      newLeads,
      contactedLeads,
      interestedLeads,
      convertedLeads,
      lostLeads,
    ] = await Promise.all([
      Lead.countDocuments(query),
      Lead.countDocuments({ ...query, status: "NEW" }),
      Lead.countDocuments({ ...query, status: "CONTACTED" }),
      Lead.countDocuments({ ...query, status: "INTERESTED" }),
      Lead.countDocuments({ ...query, status: "CONVERTED" }),
      Lead.countDocuments({ ...query, status: "LOST" }),
    ]);

    // Get follow-ups today and overdue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const followupQuery: any = { status: "SCHEDULED" };
    if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
      followupQuery.assignedTo = new mongoose.Types.ObjectId(String(user._id));
    }

    const [followupsToday, overdueFollowups] = await Promise.all([
      FollowUp.countDocuments({
        ...followupQuery,
        scheduledAt: { $gte: today, $lt: tomorrow },
      }),
      FollowUp.countDocuments({
        ...followupQuery,
        scheduledAt: { $lt: today },
      }),
    ]);

    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    return NextResponse.json({
      success: true,
      data: {
        analytics: {
          totalLeads,
          newLeads,
          contactedLeads,
          interestedLeads,
          followupsToday,
          overdueFollowups,
          convertedLeads,
          lostLeads,
          conversionRate,
        },
      },
    });
  } catch (error: any) {
    console.error("GET /api/leads/analytics error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}
