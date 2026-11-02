import mongoose from "mongoose";
import SchedulerLock from "../models/SchedulerLock";
import Organization from "../models/Organization";
import { finalizeDailyAbsentees } from "./attendanceService";
import { recordAuditLog } from "./auditLogService";
import { logger } from "../utils/logger";

export interface AbsenceSchedulerJobOptions {
  organizationId?: string | null;
  targetDate?: Date;
  force?: boolean; // bypass premature cutoff checks (e.g. for testing or explicit manual admin trigger)
  triggeredBy?: string;
}

export interface AbsenceSchedulerResult {
  jobName: string;
  scopeDate: string;
  executed: boolean;
  skippedReason?: string;
  organizationsProcessed: number;
  totalEvaluated: number;
  totalFinalizedAbsent: number;
  totalMarkedOnLeave: number;
  totalAlreadyPresent: number;
  skippedOrganizations: Array<{
    organizationId: string;
    organizationName: string;
    reason: string;
  }>;
  durationMs: number;
}

export function formatDateScope(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DEFAULT_WORKING_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const DEFAULT_WORK_END_TIME = "18:30";
const DEFAULT_GRACE_PERIOD_MINUTES = 10;
const LEASE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Executes the daily absence finalization job with distributed locking,
 * timezone and working-day sensitivity, and premature cutoff protection.
 */
export async function runAbsenceFinalizationJob(
  options: AbsenceSchedulerJobOptions = {}
): Promise<AbsenceSchedulerResult> {
  const startTime = Date.now();
  const targetDate = options.targetDate || new Date();
  const scopeDate = formatDateScope(targetDate);
  const jobName = "FINALIZE_DAILY_ABSENTEES";
  const orgLockScope = options.organizationId || "GLOBAL";
  const now = new Date();

  // 1. Acquire Distributed Lock (Atomic across multi-container instances)
  let lockDoc = await SchedulerLock.findOne({
    jobName,
    scopeDate,
    organizationId: orgLockScope,
  });

  if (lockDoc) {
    if (lockDoc.status === "COMPLETED" && !options.force) {
      return {
        jobName,
        scopeDate,
        executed: false,
        skippedReason: "ALREADY_COMPLETED: Daily absence finalization already completed for this date.",
        organizationsProcessed: 0,
        totalEvaluated: 0,
        totalFinalizedAbsent: 0,
        totalMarkedOnLeave: 0,
        totalAlreadyPresent: 0,
        skippedOrganizations: [],
        durationMs: Date.now() - startTime,
      };
    }

    if (lockDoc.status === "LOCKED" && lockDoc.lockedUntil > now) {
      return {
        jobName,
        scopeDate,
        executed: false,
        skippedReason: `LOCKED_BY_ANOTHER_INSTANCE: Job currently executing on host ${lockDoc.hostInstanceId || "unknown"}.`,
        organizationsProcessed: 0,
        totalEvaluated: 0,
        totalFinalizedAbsent: 0,
        totalMarkedOnLeave: 0,
        totalAlreadyPresent: 0,
        skippedOrganizations: [],
        durationMs: Date.now() - startTime,
      };
    }

    // Lock expired or previously failed, re-acquire
    lockDoc.status = "LOCKED";
    lockDoc.lockedAt = now;
    lockDoc.lockedUntil = new Date(now.getTime() + LEASE_DURATION_MS);
    lockDoc.hostInstanceId = process.env.HOSTNAME || `pid-${process.pid}`;
    lockDoc.errorMessage = undefined;
    await lockDoc.save();
  } else {
    try {
      lockDoc = await SchedulerLock.create({
        jobName,
        scopeDate,
        organizationId: orgLockScope,
        status: "LOCKED",
        lockedAt: now,
        lockedUntil: new Date(now.getTime() + LEASE_DURATION_MS),
        hostInstanceId: process.env.HOSTNAME || `pid-${process.pid}`,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        // Race condition: another instance created the lock simultaneously
        return {
          jobName,
          scopeDate,
          executed: false,
          skippedReason: "LOCK_ACQUISITION_RACE: Another backend instance acquired the distributed lock.",
          organizationsProcessed: 0,
          totalEvaluated: 0,
          totalFinalizedAbsent: 0,
          totalMarkedOnLeave: 0,
          totalAlreadyPresent: 0,
          skippedOrganizations: [],
          durationMs: Date.now() - startTime,
        };
      }
      throw err;
    }
  }

  // 2. Fetch target organizations
  const orgQuery: any = { status: "ACTIVE" };
  if (options.organizationId) {
    orgQuery._id = options.organizationId;
  }

  const organizations = await Organization.find(orgQuery).lean();

  const skippedOrganizations: Array<{ organizationId: string; organizationName: string; reason: string }> = [];
  let totalEvaluated = 0;
  let totalFinalizedAbsent = 0;
  let totalMarkedOnLeave = 0;
  let totalAlreadyPresent = 0;
  let organizationsProcessed = 0;

  try {
    for (const org of organizations) {
      const orgId = String(org._id);
      const tz = org.timezone || "UTC";

      // Evaluate working days
      const workingDays =
        org.workingHours?.workingDays && org.workingHours.workingDays.length > 0
          ? org.workingHours.workingDays.map((d: string) => d.toUpperCase())
          : DEFAULT_WORKING_DAYS;

      let weekdayName = "MONDAY";
      try {
        weekdayName = targetDate
          .toLocaleDateString("en-US", { weekday: "long", timeZone: tz })
          .toUpperCase();
      } catch (_) {
        weekdayName = targetDate.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
      }

      if (!workingDays.includes(weekdayName) && !options.force) {
        skippedOrganizations.push({
          organizationId: orgId,
          organizationName: org.name,
          reason: `NON_WORKING_DAY: ${weekdayName} is not a configured working day for this organization.`,
        });
        continue;
      }

      // Evaluate working hours & premature cutoff
      if (!options.force) {
        const endTimeStr = org.workingHours?.workEndTime || DEFAULT_WORK_END_TIME;
        const graceMinutes = org.workingHours?.gracePeriodMinutes ?? DEFAULT_GRACE_PERIOD_MINUTES;

        const [endHour, endMinute] = endTimeStr.split(":").map(Number);
        const cutoffDate = new Date(targetDate);
        cutoffDate.setHours(endHour, endMinute + graceMinutes, 0, 0);

        if (now.getTime() < cutoffDate.getTime()) {
          skippedOrganizations.push({
            organizationId: orgId,
            organizationName: org.name,
            reason: `PREMATURE_CUTOFF: Current time is before organization cutoff (${endTimeStr} + ${graceMinutes}m grace).`,
          });
          continue;
        }
      }

      // Execute finalization for this organization
      const results = await finalizeDailyAbsentees({
        organizationId: orgId,
        targetDate,
      });

      totalEvaluated += results.evaluated;
      totalFinalizedAbsent += results.finalizedAbsent;
      totalMarkedOnLeave += results.markedOnLeave;
      totalAlreadyPresent += results.alreadyPresent;
      organizationsProcessed++;
    }

    const durationMs = Date.now() - startTime;
    const resultSummary = {
      evaluated: totalEvaluated,
      finalizedAbsent: totalFinalizedAbsent,
      markedOnLeave: totalMarkedOnLeave,
      alreadyPresent: totalAlreadyPresent,
      organizationsProcessed,
      skippedCount: skippedOrganizations.length,
      durationMs,
    };

    // 3. Mark Lock as COMPLETED
    lockDoc.status = "COMPLETED";
    lockDoc.completedAt = new Date();
    lockDoc.resultSummary = resultSummary;
    await lockDoc.save();

    logger.info(`Absence finalization completed for ${scopeDate}: ${JSON.stringify(resultSummary)}`);

    // Audit log
    await recordAuditLog({
      organizationId: options.organizationId && mongoose.Types.ObjectId.isValid(options.organizationId) ? options.organizationId : String(new mongoose.Types.ObjectId()),
      actorId: options.triggeredBy && mongoose.Types.ObjectId.isValid(options.triggeredBy) ? options.triggeredBy : String(new mongoose.Types.ObjectId()),
      actorRole: "SYSTEM",
      action: "ATTENDANCE_DAILY_ABSENCE_FINALIZED",
      entityType: "ATTENDANCE",
      summary: `Finalized daily absentees for ${scopeDate}. Finalized: ${totalFinalizedAbsent}, On Leave: ${totalMarkedOnLeave}, Present: ${totalAlreadyPresent}`,
      metadata: resultSummary,
    });

    return {
      jobName,
      scopeDate,
      executed: true,
      organizationsProcessed,
      totalEvaluated,
      totalFinalizedAbsent,
      totalMarkedOnLeave,
      totalAlreadyPresent,
      skippedOrganizations,
      durationMs,
    };
  } catch (error: any) {
    lockDoc.status = "FAILED";
    lockDoc.errorMessage = error.message || "Unknown error during absence finalization";
    await lockDoc.save();

    logger.error(`Absence finalization failed for ${scopeDate}: ${error.message}`);
    throw error;
  }
}

// In-process scheduler instance (for long-running node daemon environments)
let schedulerIntervalId: NodeJS.Timeout | null = null;

export function startAbsenceScheduler(checkIntervalMs = 15 * 60 * 1000): void {
  if (schedulerIntervalId) return;

  logger.info("Starting in-process daily absence scheduler worker...");
  schedulerIntervalId = setInterval(async () => {
    try {
      await runAbsenceFinalizationJob();
    } catch (err: any) {
      logger.error(`Periodic absence finalization error: ${err.message}`);
    }
  }, checkIntervalMs);
}

export function stopAbsenceScheduler(): void {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    logger.info("Stopped in-process daily absence scheduler worker.");
  }
}

