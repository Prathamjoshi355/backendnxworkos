import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { runAbsenceFinalizationJob } from "../../../../services/absenceSchedulerService";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  try {
    await connectToDatabase();

    const authHeader = request.headers.get("authorization") || "";
    const cronSecretHeader = request.headers.get("x-cron-secret") || "";
    const expectedCronSecret = process.env.CRON_SECRET || process.env.NX_CRON_SECRET;

    let isAuthorizedBySecret = false;
    if (expectedCronSecret) {
      if (
        cronSecretHeader === expectedCronSecret ||
        authHeader === `Bearer ${expectedCronSecret}`
      ) {
        isAuthorizedBySecret = true;
      }
    }

    let authUser: any = null;
    if (!isAuthorizedBySecret) {
      authUser = await getUserFromRequest(request);
      if (!authUser || !requireRole(authUser, ["SUPER_ADMIN", "ADMIN"])) {
        return error(
          "FORBIDDEN",
          "Unauthorized to trigger absence scheduler. Requires valid CRON_SECRET or administrative role.",
          403
        );
      }
    }

    const body = await request.json().catch(() => ({}));
    const organizationId =
      authUser && authUser.role === "ADMIN"
        ? String(authUser.organizationId)
        : body?.organizationId || null;

    const targetDate = body?.targetDate ? new Date(body.targetDate) : undefined;
    const force = Boolean(body?.force);

    const result = await runAbsenceFinalizationJob({
      organizationId,
      targetDate,
      force,
      triggeredBy: isAuthorizedBySecret ? "CRON_WEBHOOK" : String(authUser?._id),
    });

    return success(result);
  } catch (err: any) {
    return error(
      "SCHEDULER_EXECUTION_FAILED",
      err.message || "Failed to execute absence finalization job",
      500
    );
  }
}

