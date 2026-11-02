/**
 * NXWorkOS Division Architecture Constants & Validation Rules
 *
 * Defines canonical constants, regex rules, and reserved entity checks
 * for organizational divisions within NexisparkX Private Limited.
 */

/**
 * Division code must contain 2-6 uppercase alphanumeric characters.
 * Pattern: ^[A-Z0-9]{2,6}$
 * Example valid codes: TECH, EDU, HR, CORP1, OPS, RETAIL
 */
export const DIVISION_CODE_REGEX = /^[A-Z0-9]{2,6}$/;
export const DIVISION_CODE_MIN_LENGTH = 2;
export const DIVISION_CODE_MAX_LENGTH = 6;

/**
 * Explicitly approved reserved entity identity: "NX Media".
 * Represents an external brand / media property of NexisparkX that must NOT
 * be created as an internal operational division.
 */
export const RESERVED_DIVISION_IDENTITIES = [
  "NX Media",
  "NXMedia",
  "NX-Media",
  "nx_media",
  "nx.media",
  "NexisparkX Media",
] as const;

/**
 * Validates whether a division code conforms to the approved format:
 * Exactly 2-6 uppercase alphanumeric characters matching ^[A-Z0-9]{2,6}$.
 */
export function isValidDivisionCode(code: string): boolean {
  if (!code || typeof code !== "string") return false;
  return DIVISION_CODE_REGEX.test(code.trim());
}

/**
 * Checks whether a candidate division name matches the reserved entity identity
 * "NX Media" or its canonical variants.
 *
 * IMPORTANT: In accordance with architectural decision 7, this check is strictly
 * restricted to the approved reserved entity identity ("NX Media" and its direct variants).
 * It deliberately does NOT block generic legitimate words such as "media", "central",
 * "corporate", "global", or "HQ".
 */
export function isReservedDivisionIdentity(name: string): boolean {
  if (!name || typeof name !== "string") return false;

  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return false;

  // Normalized version with whitespace, dashes, underscores, and dots removed
  const stripped = trimmed.replace(/[\s\-_.]+/g, "");

  // Collapsed version with multi-spaces/symbols normalized to a single space
  const collapsed = trimmed.replace(/[\s\-_.]+/g, " ");

  // 1. Direct canonical match for "NX Media" and "NexisparkX Media"
  if (stripped === "nxmedia" || stripped === "nexisparkxmedia") {
    return true;
  }

  // 2. Prefixed identity expressions representing the entity:
  // e.g. "nx media division", "nx media group", "nx media pvt ltd"
  if (collapsed.startsWith("nx media") || collapsed.startsWith("nexisparkx media")) {
    return true;
  }

  // 3. Stripped variants with common division/corporate entity suffixes:
  // e.g. "nxmediadivision", "nxmediagroup", "nxmediapvtltd", "nxmediacorp"
  const reservedEntitySuffixes = [
    "division",
    "group",
    "ltd",
    "pvtltd",
    "privatelimited",
    "corp",
    "inc",
    "hub",
    "unit",
    "entity",
    "team",
  ];

  if (stripped.startsWith("nxmedia")) {
    const remainder = stripped.slice("nxmedia".length);
    if (remainder.length === 0 || reservedEntitySuffixes.some((s) => remainder.startsWith(s))) {
      return true;
    }
  }

  return false;
}
