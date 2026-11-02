import crypto from "crypto";
import { Types } from "mongoose";
import NXDocument from "../models/NXDocument";
import Organization from "../models/Organization";
import {
  OFFICIAL_SYSTEM_PREFIX,
  OFFICIAL_COMPANY_CIN,
  getDocumentTypeEntry,
  isValidDocumentTypeCode,
} from "../constants/documentTypeCodes";

export { OFFICIAL_SYSTEM_PREFIX, OFFICIAL_COMPANY_CIN };

export interface GenerateDocumentIdOptions {
  documentType: string;
  organizationId?: string | Types.ObjectId;
  docDate?: Date;
  cinOverride?: string;
}

export interface ParsedDocumentId {
  prefix: string;
  cin: string;
  year: string;
  month: string;
  day: string;
  randomRef: string;
  typeCode: string;
}

export interface DocumentIdValidationResult {
  isValid: boolean;
  parsed?: ParsedDocumentId;
  error?: string;
}

/**
 * Generates a cryptographically secure, non-sequential 3-digit numeric reference (RRR).
 * Never accepts client input as authoritative.
 */
export function generateRandomReference(): string {
  // Uses crypto.randomInt to avoid predictable Math.random() implementations
  const num = crypto.randomInt(0, 1000);
  return num.toString().padStart(3, "0");
}

/**
 * Resolves and validates a document type code from a code, key, or name.
 * Enforces: exactly 3 numeric digits, no zero ('0') in any position.
 */
export function getDocumentTypeCode(documentType: string): string {
  if (!documentType || typeof documentType !== "string") {
    throw new Error("INVALID_DOCUMENT_TYPE: Document type identifier must be a non-empty string.");
  }

  const trimmed = documentType.trim();

  // If already a valid 3-digit zero-free code
  if (isValidDocumentTypeCode(trimmed)) {
    return trimmed;
  }

  // Look up in central registry
  const entry = getDocumentTypeEntry(trimmed);
  if (entry && isValidDocumentTypeCode(entry.code)) {
    return entry.code;
  }

  if (trimmed.includes("0")) {
    throw new Error(
      `INVALID_DOCUMENT_TYPE_CODE: Document type code '${trimmed}' contains '0'. Zero is strictly prohibited in document type codes.`
    );
  }

  if (/^\d+$/.test(trimmed) && trimmed.length !== 3) {
    throw new Error(
      `INVALID_DOCUMENT_TYPE_CODE: Document type code '${trimmed}' must be exactly 3 numeric digits (got ${trimmed.length}).`
    );
  }

  throw new Error(`UNSUPPORTED_DOCUMENT_TYPE: Document type '${documentType}' is not registered or supported.`);
}

// In-memory reservation cache to prevent rapid generation collisions in the same process
const reservedIds = new Map<string, number>();

/**
 * Verifies documentId uniqueness in persistent database.
 */
export async function checkDocumentIdUniqueness(id: string): Promise<boolean> {
  const existing = await NXDocument.exists({ documentId: id });
  return !existing;
}

/**
 * Validates a document ID string against the official NexisparkX specification.
 * Structure: N + CIN (21) + YY (2) + MM (2) + DD (2) + RRR (3) + TTT (3) = 34 characters.
 */
export function validateDocumentId(id: string): DocumentIdValidationResult {
  if (!id || typeof id !== "string") {
    return { isValid: false, error: "Document ID must be a non-empty string." };
  }

  // Prohibit separators
  if (id.includes("-") || id.includes("_") || id.includes(" ") || id.includes("/") || id.includes(".")) {
    return {
      isValid: false,
      error: "Document ID contains invalid separators (spaces, dashes, underscores, and slashes are prohibited).",
    };
  }

  // Check exact length: 1 (prefix) + 21 (CIN) + 6 (YYMMDD) + 3 (RRR) + 3 (TTT) = 34
  if (id.length !== 34) {
    return {
      isValid: false,
      error: `Document ID must be exactly 34 characters (got ${id.length}).`,
    };
  }

  // Validate system prefix
  if (id[0] !== OFFICIAL_SYSTEM_PREFIX) {
    return {
      isValid: false,
      error: `Document ID must start with official system prefix '${OFFICIAL_SYSTEM_PREFIX}'.`,
    };
  }

  const prefix = id.slice(0, 1);
  const cin = id.slice(1, 22);
  const year = id.slice(22, 24);
  const month = id.slice(24, 26);
  const day = id.slice(26, 28);
  const randomRef = id.slice(28, 31);
  const typeCode = id.slice(31, 34);

  // Validate CIN portion
  if (!/^[A-Z0-9]{21}$/.test(cin)) {
    return {
      isValid: false,
      error: `Document ID contains an invalid CIN portion '${cin}'. Must be 21 uppercase alphanumeric characters.`,
    };
  }

  // Validate YY
  if (!/^\d{2}$/.test(year)) {
    return { isValid: false, error: `Invalid year '${year}' in Document ID.` };
  }

  // Validate MM (01-12)
  if (!/^(0[1-9]|1[0-2])$/.test(month)) {
    return { isValid: false, error: `Invalid month '${month}' in Document ID.` };
  }

  // Validate DD (01-31)
  if (!/^(0[1-9]|[12]\d|3[01])$/.test(day)) {
    return { isValid: false, error: `Invalid day '${day}' in Document ID.` };
  }

  // Validate RRR (3 digits)
  if (!/^\d{3}$/.test(randomRef)) {
    return { isValid: false, error: `Invalid random reference '${randomRef}' in Document ID. Must be 3 numeric digits.` };
  }

  // Validate TTT (3 digits, no zero)
  if (!/^[1-9]{3}$/.test(typeCode)) {
    return {
      isValid: false,
      error: `Invalid document type code '${typeCode}' in Document ID. Must be 3 numeric digits with no zero.`,
    };
  }

  return {
    isValid: true,
    parsed: { prefix, cin, year, month, day, randomRef, typeCode },
  };
}

/**
 * Generates the official NexisparkX Document ID with server-side date, exact CIN,
 * collision handling, and unique database index verification.
 *
 * Exact Order:
 * N + Original CIN + YY + MM + DD + Random Reference (RRR) + Document Type Code (TTT)
 */
export async function generateDocumentId(options: GenerateDocumentIdOptions): Promise<string> {
  // 1. Resolve Document Type Code (TTT)
  const typeCode = getDocumentTypeCode(options.documentType);

  // 2. Resolve Organization CIN
  let resolvedCin = OFFICIAL_COMPANY_CIN;

  if (options.organizationId) {
    try {
      const org = await Organization.findById(options.organizationId).select("cin companyPrefix").lean();
      if (org?.cin && org.cin.trim().length === 21) {
        resolvedCin = org.cin.trim().toUpperCase();
      }
    } catch {
      // Fallback to official CIN if query fails
      resolvedCin = OFFICIAL_COMPANY_CIN;
    }
  } else if (options.cinOverride && options.cinOverride.trim().length === 21) {
    // Only accepted if verified server-side
    resolvedCin = options.cinOverride.trim().toUpperCase();
  }

  // 3. Resolve Server-Side Date (Never trust client date)
  const now = options.docDate instanceof Date && !isNaN(options.docDate.getTime()) ? options.docDate : new Date();

  const yearStr = now.getFullYear().toString().slice(-2);
  const monthStr = (now.getMonth() + 1).toString().padStart(2, "0");
  const dayStr = now.getDate().toString().padStart(2, "0");

  // 4. Bounded collision retry loop
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const randomRef = generateRandomReference();

    // Exact order: N + CIN + YY + MM + DD + RRR + TTT
    const candidateId = `${OFFICIAL_SYSTEM_PREFIX}${resolvedCin}${yearStr}${monthStr}${dayStr}${randomRef}${typeCode}`;

    const nowTs = Date.now();
    if (reservedIds.has(candidateId) && nowTs - (reservedIds.get(candidateId) || 0) < 10000) {
      continue;
    }

    const isUnique = await checkDocumentIdUniqueness(candidateId);
    if (isUnique) {
      reservedIds.set(candidateId, nowTs);
      return candidateId;
    }
  }

  throw new Error(`DOCUMENT_ID_COLLISION: Failed to generate a unique Document ID after ${maxAttempts} attempts.`);
}
