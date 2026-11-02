import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../middleware/auth";
import { correctAttendance } from "../../../../services/attendanceService";
import { canCorrectAttendance } from "../../../../utils/scopeHelper";
import { success, error } from "../../../../utils/response";
import Attendance from "../../../../models/Attendance";
import { recordAuditLog } from "../../../../services/auditLogService";

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user || !requireRole(user, ["SUPER_ADMIN", "ADMIN"])) {
      return error("FORBIDDEN", "Only Administrators can perform operational attendance corrections.", 403);
    }

    const body = await request.json().catch(() => ({}));
    const { attendanceId, attendanceStatus, totalWorkDuration, reason } = body;

    if (!attendanceId) {
      return error("VALIDATION_ERROR", "Attendance ID is required.", 422);
    }
    if (!reason || String(reason).trim().length < 3) {
      return error("VALIDATION_ERROR", "A valid reason for the correction is mandatory.", 422);
    }

    const attendanceRecord = await Attendance.findById(attendanceId).lean();
    if (!attendanceRecord) {
      return error("NOT_FOUND", "Attendance record not found.", 404);
    }

    const allowed = await canCorrectAttendance(user, String(attendanceRecord.userId));
    if (!allowed) {
      return error("FORBIDDEN", "Cross-organization attendance correction is not permitted.", 403);
    }

    const updated = await correctAttendance(
      attendanceId,
      {
        attendanceStatus,
        totalWorkDuration: totalWorkDuration !== undefined ? Number(totalWorkDuration) : undefined,
        reason: String(reason).trim(),
      },
      user
    );

    // Audit log
    await recordAuditLog({
      actorId: String(user._id || user.id),
      actorRole: user.role,
      organizationId: user.organizationId ? String(user.organizationId) : null,
      action: "ATTENDANCE_CORRECTED",
      entityType: "ATTENDANCE",
      entityId: attendanceId,
      summary: `Administrative attendance correction: status changed to ${attendanceStatus || attendanceRecord.attendanceStatus}`,
      metadata: {
        attendanceId,
        targetUserId: String(attendanceRecord.userId),
        previousStatus: attendanceRecord.attendanceStatus,
        newStatus: attendanceStatus || attendanceRecord.attendanceStatus,
        previousTotalWorkDuration: attendanceRecord.totalWorkDuration,
        newTotalWorkDuration: totalWorkDuration !== undefined ? Number(totalWorkDuration) : attendanceRecord.totalWorkDuration,
        reason,
      },
    });

    return success({ attendance: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to correct attendance";
    return error("ATTENDANCE_CORRECTION_FAILED", message, 500);
  }
}
