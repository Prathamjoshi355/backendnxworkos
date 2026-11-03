import { NextRequest } from "next/server";
import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import { confirmPayrollPayment } from "../../../../../services/payrollService";
import { success, error, handleApiError } from "../../../../../utils/response";

async function getId(context: any): Promise<string> {
  const p = await (context?.params || {});
  return p.id;
}

export async function POST(request: NextRequest, context: any) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) {
      return error("UNAUTHORIZED", "Not authenticated", 401);
    }

    if (!requireRole(user, ["SUPER_ADMIN", "ADMIN", "HR"])) {
      return error("FORBIDDEN", "Only Administrators and HR personnel can confirm payroll payment", 403);
    }

    const id = await getId(context);
    const body = await request.json().catch(() => ({}));
    const { transactionReference, paymentDate, paymentMode, bankName, notes } = body;

    if (!transactionReference || String(transactionReference).trim().length === 0) {
      return error("VALIDATION_ERROR", "Transaction reference is mandatory for payment confirmation", 422);
    }

    const updated = await confirmPayrollPayment(
      id,
      {
        transactionReference: String(transactionReference).trim(),
        paymentDate: paymentDate || new Date(),
        paymentMode: paymentMode || "NEFT_RTGS",
        bankName,
        notes,
      },
      user
    );

    return success({ payroll: updated });
  } catch (err: unknown) {
    return handleApiError(err, "PAYROLL_CONFIRM_PAYMENT_FAILED", "Failed to confirm payroll payment", 500);
  }
}

