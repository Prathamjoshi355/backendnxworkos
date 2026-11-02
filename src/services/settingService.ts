import SystemSetting from "../models/SystemSetting";
import Organization from "../models/Organization";
import { recordAuditLog } from "./auditLogService";

export async function getSystemSettings(organizationId: string, category?: string) {
  const filter: Record<string, unknown> = { organizationId };
  if (category) filter.category = category;

  const items = await SystemSetting.find(filter).lean();
  const org = await Organization.findById(organizationId).lean();

  return {
    organization: org,
    settings: items,
  };
}

export async function updateSystemSetting(organizationId: string, user: any, key: string, value: any, category: string = "ORGANIZATION") {
  const setting = await SystemSetting.findOneAndUpdate(
    { organizationId, key },
    {
      organizationId,
      key,
      value,
      valueType: typeof value === "number" ? "NUMBER" : typeof value === "boolean" ? "BOOLEAN" : typeof value === "object" ? "JSON" : "STRING",
      category,
      updatedBy: user._id || user.id,
    },
    { new: true, upsert: true }
  );

  await recordAuditLog({
    organizationId,
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "SYSTEM_SETTING_UPDATED",
    entityType: "SYSTEM_SETTING",
    entityId: String(setting._id),
    summary: `Updated setting ${key}`,
  });

  return setting.toObject();
}
