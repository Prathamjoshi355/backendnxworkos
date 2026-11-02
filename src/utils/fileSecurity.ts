import path from "path";

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".msi",
  ".dll",
  ".com",
  ".scr",
  ".vbs",
  ".pif",
  ".jar",
  ".bin",
]);

export const ALLOWED_MIME_EXTENSIONS_MAP: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  "text/plain": [".txt", ".log"],
  "text/csv": [".csv"],
  "application/json": [".json"],
  "application/zip": [".zip"],
  "application/x-zip-compressed": [".zip"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/octet-stream": [".bin", ".dat", ".pdf", ".docx", ".xlsx", ".zip", ".png", ".jpg", ".txt"],
};

export interface FileValidationResult {
  isValid: boolean;
  sanitizedFileName: string;
  extension: string;
  detectedMimeType: string;
  error?: string;
}

/**
 * Sanitize a filename to prevent path traversal, null bytes, and unsafe characters.
 */
export function sanitizeFileName(rawFileName: string): string {
  if (!rawFileName) return "unnamed_file";

  // Strip null bytes and control chars
  let name = rawFileName.replace(/[\x00-\x1f\x80-\x9f]/g, "");

  // Strip path separators and traversal
  name = path.basename(name);
  name = name.replace(/(\.\.[\/\\])+/g, "");

  // Replace invalid characters with underscore
  name = name.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Prevent dot-only names or names starting with dot
  if (/^\.+$/.test(name) || name.length === 0) {
    name = "file_" + Date.now();
  }

  return name;
}

/**
 * Validate upload file buffer, name, and size.
 */
export function validateUploadFile(
  buffer: Buffer,
  rawFileName: string,
  declaredMimeType?: string
): FileValidationResult {
  // 1. Size check
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      sanitizedFileName: "",
      extension: "",
      detectedMimeType: "",
      error: "FILE_EMPTY",
    };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      sanitizedFileName: "",
      extension: "",
      detectedMimeType: "",
      error: `FILE_TOO_LARGE: File size exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`,
    };
  }

  // 2. Filename sanitization & extension check
  const sanitized = sanitizeFileName(rawFileName);
  const ext = path.extname(sanitized).toLowerCase();

  if (!ext || BLOCKED_EXTENSIONS.has(ext)) {
    return {
      isValid: false,
      sanitizedFileName: sanitized,
      extension: ext,
      detectedMimeType: "",
      error: `BLOCKED_FILE_EXTENSION: Extension '${ext}' is not permitted for security reasons`,
    };
  }

  // 3. Magic bytes inspection
  let detectedMime = declaredMimeType || "application/octet-stream";

  // Inspect first 8 bytes for common signatures
  if (buffer.length >= 4) {
    if (buffer.slice(0, 4).toString("ascii") === "%PDF") {
      detectedMime = "application/pdf";
    } else if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      detectedMime = "image/png";
    } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      detectedMime = "image/jpeg";
    } else if (
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    ) {
      // PK signature (ZIP, DOCX, XLSX, PPTX)
      if (ext === ".docx") {
        detectedMime =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (ext === ".xlsx") {
        detectedMime =
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else if (ext === ".pptx") {
        detectedMime =
          "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      } else {
        detectedMime = "application/zip";
      }
    }
  }

  // 4. Validate extension matches MIME if mapped
  const allowedExtensions = ALLOWED_MIME_EXTENSIONS_MAP[detectedMime];
  if (allowedExtensions && !allowedExtensions.includes(ext)) {
    // If mismatch, fall back to safe binary or standard
    if (detectedMime !== "application/octet-stream") {
      return {
        isValid: false,
        sanitizedFileName: sanitized,
        extension: ext,
        detectedMimeType: detectedMime,
        error: `MIME_EXTENSION_MISMATCH: File extension '${ext}' does not match detected content '${detectedMime}'`,
      };
    }
  }

  return {
    isValid: true,
    sanitizedFileName: sanitized,
    extension: ext,
    detectedMimeType: detectedMime,
  };
}
