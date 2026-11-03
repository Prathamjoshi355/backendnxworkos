import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import { generatePayslipPdfBuffer } from "../../../../../services/payrollService";
import { error, handleApiError } from "../../../../../utils/response";

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
    const { buffer, fileName } = await generatePayslipPdfBuffer(id, user);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err: unknown) {
    return handleApiError(err, "PAYSLIP_GENERATION_FAILED", "Failed to generate payslip PDF", 500);
  }
}
