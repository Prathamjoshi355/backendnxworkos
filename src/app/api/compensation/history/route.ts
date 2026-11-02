import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getCompensationHistoryForUser } from "../../../../services/compensationService";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });

    const history = await getCompensationHistoryForUser(String(user._id));
    return NextResponse.json({ success: true, data: history.sort((a: any, b: any) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: { code: "COMPENSATION_HISTORY_FAILED", message: error.message || "Unable to fetch compensation history" } }, { status: 500 });
  }
}
