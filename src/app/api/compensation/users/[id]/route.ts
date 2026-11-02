import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { canViewCompensation, getCompensationHistoryForUser } from "../../../../../services/compensationService";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });

    if (!canViewCompensation(user, (await context.params).id)) {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
    }

    const history = await getCompensationHistoryForUser(String((await context.params).id));
    return NextResponse.json({ success: true, data: history.sort((a: any, b: any) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: { code: "COMPENSATION_HISTORY_FAILED", message: error.message || "Unable to fetch user compensation" } }, { status: 500 });
  }
}
