import { NextRequest } from "next/server";
import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { getPayrollById } from "../../../../services/payrollService";
import { success, error, handleApiError } from "../../../../utils/response";

async function getId(context: any): Promise<string> {
  const p = await (context?.params || {});
  return p.id;
}

export async function GET(request: NextRequest, context: any) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    const id = await getId(context);
    if (!id) {
      return error("VALIDATION_ERROR", "Payroll ID is required", 400);
    }

    const payroll = await getPayrollById(id, user);
    return success({ payroll });
  } catch (err: unknown) {
    return handleApiError(err, "PAYROLL_FETCH_FAILED", "Failed to retrieve payroll record", 500);
  }
}

