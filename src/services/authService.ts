import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User, { IUser } from "../models/User";
import { env } from "../config/env";

const JWT_SECRET = env.JWT_SECRET;

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [
    "organization.view",
    "organization.manage",
    "department.view",
    "department.manage",
    "team.view",
    "team.view.managed",
    "team.manage",
    "team.assign",
    "teamlead.manage",
    "manager.manage.teams",
    "user.view",
    "user.create",
    "user.edit",
    "user.delete",
    "employee.view.team",
    "employee.manage.team",
    "attendance.view",
    "task.view",
    "task.manage",
    "task.assign.team",
    "task.assign.employee",
    "performance.view",
    "compensation.view",
    "compensation.manage",
    "lead.view.self",
    "lead.create",
    "lead.edit",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "report.view",
    "report.export",
    "notification.view",
  ],
  ADMIN: [
    "user.view",
    "user.create",
    "user.edit",
    "department.view",
    "department.manage",
    "team.view",
    "team.view.managed",
    "team.manage",
    "team.assign",
    "teamlead.manage",
    "manager.manage.teams",
    "employee.view.team",
    "employee.manage.team",
    "attendance.view",
    "task.view",
    "task.manage",
    "task.assign.team",
    "task.assign.employee",
    "performance.view",
    "compensation.view",
    "compensation.manage",
    "lead.view.self",
    "lead.create",
    "lead.edit",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  MANAGER: [
    "task.view",
    "task.manage",
    "task.assign.team",
    "task.assign.employee",
    "team.view.managed",
    "teamlead.manage",
    "employee.view.team",
    "employee.manage.team",
    "attendance.view",
    "leave.review",
    "report.view",
    "lead.view.self",
    "lead.create",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  TEAM_LEADER: [
    "task.view",
    "task.manage",
    "task.assign.employee",
    "team.view.self",
    "employee.view.team",
    "attendance.view",
    "leave.review",
    "lead.view.self",
    "lead.assign",
    "lead.call",
    "lead.followup",
    "notification.view",
  ],
  SALES_EXECUTIVE: [
    "lead.view.self",
    "lead.call",
    "lead.followup",
    "task.view",
    "attendance.view",
  ],
  EMPLOYEE: [
    "task.view",
    "attendance.view",
    "notification.view",
  ],
  INTERN: [
    "task.view",
    "attendance.view",
    "notification.view",
  ],
};

function getEffectivePermissions(user: Partial<IUser> | any) {
  const granted = new Set<string>(Array.isArray(user?.permissions) ? user.permissions : []);
  const denied = new Set<string>(Array.isArray(user?.deniedPermissions) ? user.deniedPermissions : []);
  const defaults = DEFAULT_ROLE_PERMISSIONS[user?.role] ?? [];

  for (const permission of defaults) granted.add(permission);

  const effective = [...granted].filter((permission) => !denied.has(permission));
  return [...new Set(effective)].sort();
}

export function toSafeUser(user: Partial<IUser>) {
  const { passwordHash, ...rest } = user as any;
  const effectivePermissions = getEffectivePermissions(rest);
  return {
    ...rest,
    mustChangePassword: Boolean(rest.mustChangePassword),
    passwordChangedAt: rest.passwordChangedAt || null,
    permissions: Array.isArray(rest.permissions) ? rest.permissions : [],
    deniedPermissions: Array.isArray(rest.deniedPermissions) ? rest.deniedPermissions : [],
    effectivePermissions,
    accessScope: rest.accessScope || rest.scope || resolveAccessScope(rest),
    scope: rest.accessScope || rest.scope || resolveAccessScope(rest),
  };
}

function resolveAccessScope(user: Partial<IUser> | any) {
  if (user?.role === "SUPER_ADMIN") return "ORGANIZATION";
  if (user?.role === "ADMIN") return user?.departmentId ? "DEPARTMENT" : "ORGANIZATION";
  if (user?.teamId) return "TEAM";
  if (user?.departmentId) return "DEPARTMENT";
  return "SELF";
}

export async function registerUser(payload: { fullName: string; email: string; password: string; role?: string; employmentType?: string; organizationId?: string | any }) {
  const existing = await User.findOne({ email: payload.email.toLowerCase() }).lean();
  if (existing) throw new Error("EMAIL_EXISTS");

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(payload.password, salt);

  const created = await User.create({
    fullName: payload.fullName,
    email: payload.email.toLowerCase(),
    passwordHash: hash,
    role: payload.role || undefined,
    employmentType: payload.employmentType || undefined,
    organizationId: payload.organizationId || null,
  } as any);

  return toSafeUser(created.toObject());
}

export async function loginUser(identifier: string, password: string) {
  const value = identifier.trim();
  const user = await User.findOne({
    $or: [
      { email: value.toLowerCase() },
      { employeeId: value },
    ],
  }).select("+passwordHash");

  if (!user) throw new Error("INVALID_CREDENTIALS");

  if (user.status && user.status !== "ACTIVE") throw new Error("USER_INACTIVE");

  if (user.mustChangePassword && user.passwordMetadata?.temporaryPasswordAssignedAt) {
    const assignedAt = new Date(user.passwordMetadata.temporaryPasswordAssignedAt).getTime();
    const expiryDays = Number(process.env.TEMPORARY_PASSWORD_EXPIRY_DAYS) || 7;
    const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
    if (Date.now() - assignedAt > expiryMs) {
      throw new Error("TEMPORARY_CREDENTIALS_EXPIRED: Temporary onboarding password has expired. Please contact an Administrator or HR.");
    }
  }
  const match = await bcrypt.compare(password, (user as any).passwordHash);
  if (!match) throw new Error("INVALID_CREDENTIALS");

  // Ensure organizationId is populated if user has none
  if (!user.organizationId) {
    const Organization = (await import("../models/Organization")).default;
    let org = await Organization.findOne().lean();
    if (!org) {
      const createdOrg = await Organization.create({
        name: "NexisparkX Enterprise",
        code: "NX-MAIN",
        domain: "nexipark.com",
      });
      org = createdOrg.toObject();
    }
    user.organizationId = org._id as any;
  }

  user.lastLoginAt = new Date();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        lastLoginAt: user.lastLoginAt,
        organizationId: user.organizationId,
      },
    }
  );

  const nowMs = Date.now();
  const token = jwt.sign(
    { sub: user._id.toString(), role: user.role, pwdVersion: nowMs },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  const safeUser = toSafeUser(user.toObject());

  return {
    token,
    mustChangePassword: Boolean(user.mustChangePassword),
    user: {
      ...safeUser,
      mustChangePassword: Boolean(user.mustChangePassword),
      organizationId: user.organizationId ? String(user.organizationId) : safeUser.organizationId,
      accessScope: safeUser.accessScope || resolveAccessScope(user.toObject()),
      scope: safeUser.scope || resolveAccessScope(user.toObject()),
    },
  };
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword?: string;
}) {
  const { userId, currentPassword, newPassword, confirmPassword } = params;

  if (!userId) {
    throw new Error("USER_REQUIRED");
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    throw new Error("PASSWORD_CONFIRMATION_MISMATCH");
  }

  const { isStrongPassword } = await import("../validators/auth");
  if (!isStrongPassword(newPassword)) {
    throw new Error("WEAK_PASSWORD: Password must be at least 8 characters and include uppercase, lowercase, and a number or symbol.");
  }

  if (currentPassword === newPassword) {
    throw new Error("NEW_PASSWORD_SAME_AS_CURRENT: New password cannot be identical to current password.");
  }

  const user = await User.findById(userId).select("+passwordHash");
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const match = await bcrypt.compare(currentPassword, (user as any).passwordHash);
  if (!match) {
    throw new Error("INVALID_CURRENT_PASSWORD");
  }

  const salt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, salt);
  const now = new Date();

  user.passwordHash = newHash;
  user.mustChangePassword = false;
  user.passwordChangedAt = now;
  user.passwordMetadata = {
    ...(user.passwordMetadata || {}),
    lastChangedAt: now,
    changedBy: String(user._id),
  };

  await user.save();

  const { recordAuditLog } = await import("./auditLogService");
  await recordAuditLog({
    organizationId: String(user.organizationId || ""),
    actorId: String(user._id),
    actorRole: user.role,
    action: "USER_PASSWORD_CHANGED",
    entityType: "USER",
    entityId: String(user._id),
    summary: `User ${user.fullName} successfully changed password`,
    metadata: {
      firstLoginChange: Boolean(user.mustChangePassword),
      changedAt: now,
    },
  });

  const safe = toSafeUser(user.toObject());
  const token = jwt.sign(
    { sub: user._id.toString(), role: user.role, pwdVersion: now.getTime() },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  return { ...safe, user: safe, token };
}

export function verifyToken(token: string) {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return payload;
  } catch (err) {
    return null;
  }
}
