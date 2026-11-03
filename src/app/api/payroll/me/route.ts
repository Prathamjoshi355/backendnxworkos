import { NextRequest } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { listPayrolls } from "../../../../services/payrollService";
import { success, error, handleApiError } from "../../../../utils/response";

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const { searchParams } = new URL(request.url);
    const orgId = String(user.organizationId || "");
    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 12;

    const result = await listPayrolls(
      orgId,
      {
        payrollYear: year,
        page,
        limit,
      },
      user // listPayrolls automatically scopes EMPLOYEE and INTERN to user._id
    );

    return success(result);
  } catch (err: unknown) {
    return handleApiError(err, "MY_PAYROLL_FETCH_FAILED", "Failed to retrieve your payroll records", 500);
  }
}

