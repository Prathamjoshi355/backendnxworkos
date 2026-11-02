import AuditLog from "../models/AuditLog";

const SECRET_KEYS = new Set(["password", "passwordHash", "token", "jwt", "secret", "databaseUrl", "MONGODB_URI"]);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key) || key.toLowerCase().includes("password") || key.toLowerCase().includes("token")) continue;
    output[key] = scrub(child);
  }
  return output;
}

export async function recordAuditLog(input: {
  organizationId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return AuditLog.create({
    ...input,
    metadata: scrub(input.metadata || {}),
  });
}

export async function listAuditLogs(
  filter: Record<string, unknown>,
  opts: { skip?: number; limit?: number; search?: string; startDate?: Date | string; endDate?: Date | string } = {}
) {
  const skip = opts.skip || 0;
  const limit = opts.limit || 50;

  const finalQuery: Record<string, unknown> = { ...filter };

  if (opts.startDate || opts.endDate) {
    const dateQuery: Record<string, unknown> = {};
    if (opts.startDate) dateQuery.$gte = new Date(opts.startDate);
    if (opts.endDate) dateQuery.$lte = new Date(opts.endDate);
    finalQuery.createdAt = dateQuery;
  }

  if (opts.search) {
    const searchRegex = { $regex: opts.search, $options: "i" };
    finalQuery.$or = [
      { action: searchRegex },
      { summary: searchRegex },
      { entityType: searchRegex },
    ];
  }

  const items = await AuditLog.find(finalQuery)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("actorId", "fullName email employeeId role")
    .lean();
  const total = await AuditLog.countDocuments(finalQuery);
  return { items, total };
}
