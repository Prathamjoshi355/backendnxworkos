import Compensation, { CompensationStatus, CompensationType } from "../models/Compensation";
import CompensationAudit from "../models/CompensationAudit";
import User from "../models/User";
import { getSocket } from "../lib/socket";
import { createNotification } from "./notificationService";
import { hasCompensationPermission } from "../middleware/auth";

const DEFAULT_CURRENCY = "INR";
const VALID_CURRENCIES = new Set(["INR", "USD", "EUR", "GBP"]);
const VALID_PAY_FREQUENCIES = new Set(["MONTHLY", "YEARLY"]);

function normalizeCompensationType(userEmploymentType: string, requestedType?: string) {
  const employment = userEmploymentType?.toUpperCase();
  const requested = requestedType?.toUpperCase();

  if (employment === "INTERN" && requested && requested !== "STIPEND") {
    return "STIPEND";
  }

  if (employment === "EMPLOYEE" && requested && requested !== "SALARY") {
    return "SALARY";
  }

  return requested || (employment === "INTERN" ? "STIPEND" : "SALARY");
}

function canManageCompensation(user: any) {
  if (!user) return false;
  return hasCompensationPermission(user, "compensation.edit") || hasCompensationPermission(user, "compensation.create") || user.role === "SUPER_ADMIN" || user.role === "ADMIN";
}

export async function getCurrentCompensationForUser(userId: string) {
  const record = await Compensation.findOne({ userId, status: "ACTIVE" }).sort({ effectiveFrom: -1 }).lean();
  return record;
}

export async function getCompensationHistoryForUser(userId: string) {
  return Compensation.find({ userId }).sort({ effectiveFrom: -1 }).lean();
}

export async function getCompensationById(id: string) {
  return Compensation.findById(id).lean();
}

export async function getUserCompensationForAdmin(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("USER_NOT_FOUND");
  return Compensation.find({ userId }).sort({ effectiveFrom: -1 }).lean();
}

export async function createCompensation(data: {
  userId: string;
  organizationId: string;
  employmentType?: string;
  compensationType?: string;
  baseAmount: number;
  currency?: string;
  payFrequency?: string;
  effectiveFrom: string | Date;
  createdBy: string;
  reason?: string;
}) {
  const user = await User.findById(data.userId).lean();
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.status && user.status !== "ACTIVE") throw new Error("USER_INACTIVE");

  if (!data.organizationId) throw new Error("ORGANIZATION_REQUIRED");
  const organization = await (await import("../models/Organization")).default.findById(data.organizationId).lean();
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");

  const employmentType = (user.employmentType || data.employmentType || "EMPLOYEE").toUpperCase();
  if (!['EMPLOYEE', 'INTERN'].includes(employmentType)) throw new Error("INVALID_EMPLOYMENT_TYPE");

  const finalType = normalizeCompensationType(employmentType, data.compensationType);
  if (!['SALARY', 'STIPEND'].includes(finalType)) throw new Error("INVALID_COMPENSATION_TYPE");

  if (Number(data.baseAmount) < 0) throw new Error("INVALID_AMOUNT");
  const effectiveFrom = new Date(data.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) throw new Error("INVALID_EFFECTIVE_DATE");

  const normalizedCurrency = (data.currency || DEFAULT_CURRENCY).toUpperCase();
  if (!VALID_CURRENCIES.has(normalizedCurrency)) throw new Error("INVALID_CURRENCY");

  const normalizedFrequency = (data.payFrequency || "MONTHLY").toUpperCase();
  if (!VALID_PAY_FREQUENCIES.has(normalizedFrequency)) throw new Error("INVALID_PAY_FREQUENCY");

  const activeOverlap = await Compensation.findOne({
    userId: data.userId,
    status: "ACTIVE",
    $or: [
      { effectiveFrom: { $lte: effectiveFrom }, effectiveTo: null },
      { effectiveFrom: { $lte: effectiveFrom }, effectiveTo: { $gt: effectiveFrom } },
    ],
  }).lean();

  if (activeOverlap) {
    throw new Error("DUPLICATE_ACTIVE_COMPENSATION");
  }

  const record = await Compensation.create({
    userId: data.userId,
    organizationId: data.organizationId,
    employmentType,
    compensationType: finalType,
    baseAmount: Number(data.baseAmount),
    currency: normalizedCurrency,
    payFrequency: normalizedFrequency,
    effectiveFrom,
    effectiveTo: null,
    status: "ACTIVE",
    reason: data.reason || null,
    createdBy: data.createdBy,
  });

  await CompensationAudit.create({
    compensationId: record._id,
    userId: data.userId,
    action: "CREATED",
    newAmount: Number(data.baseAmount),
    newType: finalType,
    effectiveFrom: new Date(data.effectiveFrom),
    changedBy: data.createdBy,
    reason: data.reason || null,
  });

  try {
    const socket = getSocket();
    socket.to(`user:${data.userId}`).emit("compensation:updated", {
      userId: String(data.userId),
      compensationType: finalType,
      status: "ACTIVE",
      effectiveFrom: new Date(data.effectiveFrom).toISOString(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    // ignore socket failures outside runtime
  }

  try {
    await createNotification({
      recipientId: data.userId,
      type: "TASK_UPDATED" as any,
      title: "Compensation Updated",
      message: "Your compensation information has been updated.",
      entityType: "COMPENSATION",
      entityId: String(record._id),
      priority: "NORMAL",
    });
  } catch {
    // ignore notification errors outside runtime
  }

  return record.toObject();
}

export async function updateCompensation(id: string, updates: {
  baseAmount?: number;
  compensationType?: string;
  payFrequency?: string;
  currency?: string;
  reason?: string;
  status?: CompensationStatus;
  effectiveFrom?: string | Date;
  effectiveTo?: string | Date | null;
}, changedBy: string) {
  const existing = await Compensation.findById(id).lean();
  if (!existing) throw new Error("COMPENSATION_NOT_FOUND");

  if (updates.baseAmount !== undefined && Number(updates.baseAmount) < 0) throw new Error("INVALID_AMOUNT");
  if (updates.currency) {
    const normalizedCurrency = String(updates.currency).toUpperCase();
    if (!VALID_CURRENCIES.has(normalizedCurrency)) throw new Error("INVALID_CURRENCY");
  }
  if (updates.payFrequency) {
    const normalizedFrequency = String(updates.payFrequency).toUpperCase();
    if (!VALID_PAY_FREQUENCIES.has(normalizedFrequency)) throw new Error("INVALID_PAY_FREQUENCY");
  }
  if (updates.effectiveFrom) {
    const effectiveFrom = new Date(updates.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) throw new Error("INVALID_EFFECTIVE_DATE");
  }
  if (updates.effectiveTo) {
    const effectiveTo = new Date(updates.effectiveTo);
    if (Number.isNaN(effectiveTo.getTime())) throw new Error("INVALID_EFFECTIVE_TO");
    const sourceDate = updates.effectiveFrom ? new Date(updates.effectiveFrom) : existing.effectiveFrom;
    if (effectiveTo < sourceDate) throw new Error("EFFECTIVE_TO_BEFORE_EFFECTIVE_FROM");
  }

  const nextType = updates.compensationType ? String(updates.compensationType).toUpperCase() : existing.compensationType;
  if (!['SALARY', 'STIPEND'].includes(nextType)) throw new Error("INVALID_COMPENSATION_TYPE");

  const effectiveFrom = updates.effectiveFrom ? new Date(updates.effectiveFrom) : existing.effectiveFrom;
  const effectiveToValue = updates.effectiveTo ? new Date(updates.effectiveTo) : null;

  const overlapCheck = await Compensation.findOne({
    userId: existing.userId,
    _id: { $ne: id },
    status: "ACTIVE",
    $or: [
      { effectiveFrom: { $lte: effectiveFrom }, effectiveTo: null },
      { effectiveFrom: { $lte: effectiveFrom }, effectiveTo: { $gt: effectiveFrom } },
    ],
  }).lean();

  if (overlapCheck) {
    throw new Error("DUPLICATE_ACTIVE_COMPENSATION");
  }

  const previousRecord = { ...existing };
  const nextRecord = await Compensation.create({
    userId: existing.userId,
    organizationId: existing.organizationId,
    employmentType: existing.employmentType,
    compensationType: nextType,
    baseAmount: Number(updates.baseAmount ?? existing.baseAmount),
    currency: String((updates.currency || existing.currency || DEFAULT_CURRENCY)).toUpperCase(),
    payFrequency: String((updates.payFrequency || existing.payFrequency || "MONTHLY")).toUpperCase(),
    effectiveFrom,
    effectiveTo: effectiveToValue,
    status: "ACTIVE",
    reason: updates.reason || existing.reason || null,
    createdBy: changedBy,
  });

  await Compensation.findByIdAndUpdate(id, {
    status: "REVISED",
    effectiveTo: effectiveFrom,
    reason: updates.reason || existing.reason || null,
  });

  await CompensationAudit.create({
    compensationId: nextRecord._id,
    userId: existing.userId,
    action: "REVISED",
    previousAmount: previousRecord.baseAmount,
    newAmount: Number(updates.baseAmount ?? existing.baseAmount),
    previousType: previousRecord.compensationType,
    newType: nextType,
    effectiveFrom,
    changedBy,
    reason: updates.reason || previousRecord.reason || null,
  });

  try {
    const socket = getSocket();
    socket.to(`user:${existing.userId}`).emit("compensation:updated", {
      userId: String(existing.userId),
      compensationType: nextType,
      status: "ACTIVE",
      effectiveFrom: new Date(effectiveFrom).toISOString(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    // ignore socket failures outside runtime
  }

  try {
    await createNotification({
      recipientId: String(existing.userId),
      type: "COMPENSATION_UPDATED" as any,
      title: "Compensation Updated",
      message: "Your compensation information has been updated.",
      entityType: "COMPENSATION",
      entityId: String(nextRecord._id),
      priority: "NORMAL",
    });
  } catch {
    // ignore notification concerns outside runtime
  }

  return nextRecord.toObject();
}

export async function setCompensationStatus(id: string, status: CompensationStatus, changedBy: string) {
  const current = await Compensation.findById(id).lean();
  if (!current) throw new Error("COMPENSATION_NOT_FOUND");

  if (status === "ACTIVE") {
    const overlapCheck = await Compensation.findOne({
      userId: current.userId,
      _id: { $ne: id },
      status: "ACTIVE",
      $or: [
        { effectiveFrom: { $lte: current.effectiveFrom }, effectiveTo: null },
        { effectiveFrom: { $lte: current.effectiveFrom }, effectiveTo: { $gt: current.effectiveFrom } },
      ],
    }).lean();
    if (overlapCheck) throw new Error("DUPLICATE_ACTIVE_COMPENSATION");
  }

  const updated = await Compensation.findByIdAndUpdate(id, { status }, { new: true }).lean();
  await CompensationAudit.create({
    compensationId: id,
    userId: current.userId,
    action: status === "ACTIVE" ? "ACTIVATED" : "DEACTIVATED",
    previousAmount: current.baseAmount,
    newAmount: current.baseAmount,
    previousType: current.compensationType,
    newType: current.compensationType,
    effectiveFrom: current.effectiveFrom,
    changedBy,
    reason: `Status changed to ${status}`,
  });

  if (status === "ACTIVE") {
    try {
      const socket = getSocket();
      socket.to(`user:${current.userId}`).emit("compensation:updated", {
        userId: String(current.userId),
        compensationType: current.compensationType,
        status: "ACTIVE",
        effectiveFrom: new Date(current.effectiveFrom).toISOString(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // ignore socket failures outside runtime
    }
  }

  return updated;
}

export function canViewCompensation(user: any, targetUserId: string | undefined) {
  if (!user) return false;
  if (!targetUserId) return false;
  if (String(user._id) === String(targetUserId)) return true;
  return canManageCompensation(user);
}

export function canAccessCompensationHistory(user: any, targetUserId?: string) {
  if (!user) return false;
  if (!targetUserId) return canManageCompensation(user);
  if (String(user._id) === String(targetUserId)) return true;
  return canManageCompensation(user);
}
