import AppVersion from "../models/AppVersion";
import { recordAuditLog } from "./auditLogService";

/**
 * Compare two Semantic Version strings (e.g. "1.10.0" vs "1.9.0").
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 == v2
 */
export function compareVersions(v1: string, v2: string): number {
  const cleanV1 = (v1 || "1.0.0").split("+")[0].split("-")[0].trim();
  const cleanV2 = (v2 || "1.0.0").split("+")[0].split("-")[0].trim();

  const parts1 = cleanV1.split(".").map((p) => parseInt(p, 10) || 0);
  const parts2 = cleanV2.split(".").map((p) => parseInt(p, 10) || 0);

  const maxLength = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLength; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export async function getAppVersionConfig(clientPlatform?: string, currentVersion?: string) {
  const foundConfig = await AppVersion.findOne({ isEnabled: true }).sort({ updatedAt: -1 }).lean();

  const versionConfig: Record<string, any> = foundConfig || {
    latestVersion: "1.0.0",
    minimumSupportedVersion: "1.0.0",
    releaseNotes: "Bug fixes and performance improvements",
    windowsDownloadUrl: "http://localhost:3000/downloads/windows",
    androidDownloadUrl: "http://localhost:3000/downloads/android",
    publishedAt: new Date(),
    isEnabled: true,
  };

  const latestVersion = String(versionConfig.latestVersion || "1.0.0");
  const minimumSupportedVersion = String(versionConfig.minimumSupportedVersion || "1.0.0");
  const clientVer = currentVersion || "1.0.0";

  const updateAvailable = compareVersions(clientVer, latestVersion) < 0;
  const isSupported = compareVersions(clientVer, minimumSupportedVersion) >= 0;

  const platform = (clientPlatform || "").toLowerCase();
  const downloadUrl = platform.includes("win")
    ? versionConfig.windowsDownloadUrl
    : platform.includes("android")
    ? versionConfig.androidDownloadUrl
    : versionConfig.windowsDownloadUrl || versionConfig.androidDownloadUrl;

  const forceUpdate = compareVersions(clientVer, minimumSupportedVersion) < 0;

  return {
    version: latestVersion,
    latestVersion,
    minimumSupportedVersion,
    currentVersion: clientVer,
    updateAvailable,
    isSupported,
    forceUpdate,
    releaseNotes: String(versionConfig.releaseNotes || "Bug fixes and performance improvements"),
    windowsDownloadUrl: String(versionConfig.windowsDownloadUrl || ""),
    androidDownloadUrl: String(versionConfig.androidDownloadUrl || ""),
    downloadUrl: String(downloadUrl || ""),
    updateUrl: String(downloadUrl || ""),
    publishedAt: versionConfig.publishedAt || new Date(),
  };
}

export async function updateAppVersionConfig(user: any, payload: any) {
  const latestVersion = String(payload.latestVersion || "1.0.0").trim();
  const minimumSupportedVersion = String(payload.minimumSupportedVersion || "1.0.0").trim();
  const releaseNotes = String(payload.releaseNotes || "Bug fixes and performance improvements").trim();
  const windowsDownloadUrl = String(payload.windowsDownloadUrl || "").trim();
  const androidDownloadUrl = String(payload.androidDownloadUrl || "").trim();

  const updated = await AppVersion.findOneAndUpdate(
    {},
    {
      latestVersion,
      minimumSupportedVersion,
      releaseNotes,
      windowsDownloadUrl,
      androidDownloadUrl,
      publishedAt: new Date(),
      isEnabled: true,
      updatedBy: user._id || user.id,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  if (user.organizationId && updated) {
    await recordAuditLog({
      organizationId: String(user.organizationId),
      actorId: String(user._id || user.id),
      actorRole: user.role,
      action: "APP_VERSION_UPDATED",
      entityType: "SYSTEM_SETTING",
      entityId: String(updated._id),
      summary: `Updated app version to ${latestVersion} (min ${minimumSupportedVersion})`,
    });
  }

  return updated;
}
