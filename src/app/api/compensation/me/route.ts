import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getCurrentCompensationForUser } from "../../../../services/compensationService";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });

    const compensation = await getCurrentCompensationForUser(String(user._id));
    return NextResponse.json({ success: true, data: compensation });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: { code: "COMPENSATION_FETCH_FAILED", message: error.message || "Unable to fetch current compensation" } }, { status: 500 });
  }
}
