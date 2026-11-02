import fs from "fs";
import path from "path";
import crypto from "crypto";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { R2Client } from "./storage/r2Client";

export interface StorageUploadResult {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksum: string;
  storagePath: string;
  storageProvider: "R2" | "LOCAL";
  bucket?: string | null;
  objectKey?: string | null;
}

export interface IStorageProvider {
  providerName: "R2" | "LOCAL";
  upload(file: {
    buffer: Buffer | string;
    fileName: string;
    mimeType?: string;
    destinationSubdir?: string;
    organizationId?: string;
    employeeId?: string;
    fileId?: string;
  }): Promise<StorageUploadResult>;
  read(storagePathOrKey: string): Promise<{ buffer: Buffer; size: number; mimeType?: string }>;
  delete(storagePathOrKey: string): Promise<boolean>;
  getUrl(storagePathOrKey: string): string;
  exists(storagePathOrKey: string): Promise<boolean>;
  stat(storagePathOrKey: string): Promise<{ size: number; mtime: Date } | null>;
  getSignedDownloadUrl?(storagePathOrKey: string, expiresInSeconds?: number): Promise<string>;
  healthCheck(): Promise<{ healthy: boolean; details?: any }>;
}

/**
 * Cloudflare R2 Storage Provider (Production Default)
 * Stores binary documents in a private Cloudflare R2 bucket with tenant-isolated object keys.
 */
export class R2StorageProvider implements IStorageProvider {
  public providerName: "R2" = "R2";
  private r2Client: R2Client;
  private bucketName: string;

  constructor(clientOverride?: R2Client) {
    if (clientOverride) {
      this.r2Client = clientOverride;
      this.bucketName = clientOverride.getBucketName();
    } else {
      this.r2Client = new R2Client({
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: env.R2_SECRET_ACCESS_KEY || "",
        bucketName: env.R2_BUCKET_NAME || "nxworkos-production-docs",
        endpoint: env.R2_ENDPOINT,
        publicUrl: env.R2_PUBLIC_URL,
      });
      this.bucketName = env.R2_BUCKET_NAME || "nxworkos-production-docs";
    }
  }

  private sanitizeComponent(comp: string): string {
    return comp
      .replace(/^\.\.[\/\\]/, "_")
      .replace(/\.\.[\/\\]/g, "__")
      .replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /**
   * Deterministic tenant-isolated object key generator:
   * organizations/{orgId}/employees/{employeeId}/documents/{fileId}/{timestamp}_{safeFileName}
   */
  public generateObjectKey(params: {
    organizationId?: string;
    employeeId?: string;
    fileId?: string;
    fileName: string;
  }): string {
    const orgId = this.sanitizeComponent(params.organizationId || "global");
    const empId = this.sanitizeComponent(params.employeeId || "common");
    const fileId = this.sanitizeComponent(params.fileId || `file_${Date.now()}`);
    const baseName = path.basename(params.fileName);
    const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const timestamp = Date.now();

    return `organizations/${orgId}/employees/${empId}/documents/${fileId}/${timestamp}_${safeName}`;
  }

  async upload(file: {
    buffer: Buffer | string;
    fileName: string;
    mimeType?: string;
    destinationSubdir?: string;
    organizationId?: string;
    employeeId?: string;
    fileId?: string;
  }): Promise<StorageUploadResult> {
    let buffer: Buffer;
    if (typeof file.buffer === "string") {
      if (file.buffer.startsWith("data:") && file.buffer.includes(";base64,")) {
        const base64Data = file.buffer.split(";base64,").pop() || "";
        buffer = Buffer.from(base64Data, "base64");
      } else {
        buffer = Buffer.from(file.buffer, "utf-8");
      }
    } else {
      buffer = file.buffer;
    }

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const mimeType = file.mimeType || "application/octet-stream";

    const objectKey = this.generateObjectKey({
      organizationId: file.organizationId || file.destinationSubdir,
      employeeId: file.employeeId,
      fileId: file.fileId,
      fileName: file.fileName,
    });

    const safeStoredName = path.basename(objectKey);

    // Upload binary stream to Cloudflare R2
    await this.r2Client.putObject(objectKey, buffer, mimeType);

    logger.info("Uploaded binary to Cloudflare R2", {
      objectKey,
      bucket: this.bucketName,
      size: buffer.length,
      checksum,
    });

    return {
      fileUrl: `/api/files/download?key=${encodeURIComponent(objectKey)}`,
      fileName: safeStoredName,
      fileSize: buffer.length,
      mimeType,
      checksum,
      storagePath: objectKey,
      storageProvider: "R2",
      bucket: this.bucketName,
      objectKey,
    };
  }

  async read(storagePathOrKey: string): Promise<{ buffer: Buffer; size: number; mimeType?: string }> {
    return this.r2Client.getObject(storagePathOrKey);
  }

  async delete(storagePathOrKey: string): Promise<boolean> {
    return this.r2Client.deleteObject(storagePathOrKey);
  }

  getUrl(storagePathOrKey: string): string {
    return `/api/files/download?key=${encodeURIComponent(storagePathOrKey)}`;
  }

  async exists(storagePathOrKey: string): Promise<boolean> {
    const head = await this.r2Client.headObject(storagePathOrKey);
    return head !== null;
  }

  async stat(storagePathOrKey: string): Promise<{ size: number; mtime: Date } | null> {
    return this.r2Client.headObject(storagePathOrKey);
  }

  async getSignedDownloadUrl(storagePathOrKey: string, expiresInSeconds: number = 900): Promise<string> {
    return this.r2Client.getPresignedUrl(storagePathOrKey, expiresInSeconds);
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: any }> {
    return this.r2Client.healthCheck();
  }
}

/**
 * Local File Storage Provider (Development / Fallback Only)
 */
export class LocalStorageProvider implements IStorageProvider {
  public providerName: "LOCAL" = "LOCAL";
  private baseDir: string;
  private publicUrlPrefix: string;

  constructor() {
    this.baseDir = path.resolve(process.cwd(), "public", "uploads", "docs");
    this.publicUrlPrefix = "/uploads/docs";
    this.ensureDirectoryExists(this.baseDir);
  }

  private ensureDirectoryExists(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private resolveStoragePath(storagePathOrUrl: string): string {
    let clean = storagePathOrUrl.replace(this.publicUrlPrefix, "");
    clean = clean.replace(/^[\/\\]+/, "").replace(/^[a-zA-Z]:[\/\\]/, "");
    clean = clean.replace(/(\.\.[\/\\])+/g, "");
    const resolved = path.resolve(this.baseDir, clean);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error("INVALID_STORAGE_PATH");
    }
    return resolved;
  }

  async upload(file: {
    buffer: Buffer | string;
    fileName: string;
    mimeType?: string;
    destinationSubdir?: string;
    organizationId?: string;
    employeeId?: string;
    fileId?: string;
  }): Promise<StorageUploadResult> {
    const cleanSubdir = (file.organizationId || file.destinationSubdir || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const subDir = cleanSubdir ? path.join(this.baseDir, cleanSubdir) : this.baseDir;
    this.ensureDirectoryExists(subDir);

    const safeName = this.sanitizeFileName(file.fileName);
    const timestamp = Date.now();
    const finalFileName = `${timestamp}_${safeName}`;
    const targetFilePath = path.resolve(subDir, finalFileName);

    if (!targetFilePath.startsWith(this.baseDir)) {
      throw new Error("INVALID_STORAGE_PATH");
    }

    let buffer: Buffer;
    if (typeof file.buffer === "string") {
      if (file.buffer.startsWith("data:") && file.buffer.includes(";base64,")) {
        const base64Data = file.buffer.split(";base64,").pop() || "";
        buffer = Buffer.from(base64Data, "base64");
      } else {
        buffer = Buffer.from(file.buffer, "utf-8");
      }
    } else {
      buffer = file.buffer;
    }

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    await fs.promises.writeFile(targetFilePath, buffer);

    const subPath = cleanSubdir ? `${cleanSubdir}/${finalFileName}` : finalFileName;
    const fileUrl = `${this.publicUrlPrefix}/${subPath}`;

    return {
      fileUrl,
      fileName: finalFileName,
      fileSize: buffer.length,
      mimeType: file.mimeType || "application/pdf",
      checksum,
      storagePath: subPath,
      storageProvider: "LOCAL",
      bucket: null,
      objectKey: subPath,
    };
  }

  async read(storagePathOrUrl: string): Promise<{ buffer: Buffer; size: number; mimeType?: string }> {
    const fullPath = this.resolveStoragePath(storagePathOrUrl);
    if (!fs.existsSync(fullPath)) {
      throw new Error("FILE_NOT_FOUND_ON_STORAGE");
    }
    const buffer = await fs.promises.readFile(fullPath);
    return {
      buffer,
      size: buffer.length,
    };
  }

  async delete(storagePathOrUrl: string): Promise<boolean> {
    try {
      const fullPath = this.resolveStoragePath(storagePathOrUrl);
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  getUrl(filePath: string): string {
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      return filePath;
    }
    const clean = filePath.startsWith("/") ? filePath.slice(1) : filePath;
    return `${this.publicUrlPrefix}/${clean}`;
  }

  async exists(storagePathOrUrl: string): Promise<boolean> {
    try {
      const fullPath = this.resolveStoragePath(storagePathOrUrl);
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
  }

  async stat(storagePathOrUrl: string): Promise<{ size: number; mtime: Date } | null> {
    try {
      const fullPath = this.resolveStoragePath(storagePathOrUrl);
      if (!fs.existsSync(fullPath)) return null;
      const stats = await fs.promises.stat(fullPath);
      return {
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: any }> {
    try {
      this.ensureDirectoryExists(this.baseDir);
      return { healthy: true, details: { baseDir: this.baseDir } };
    } catch (err: any) {
      return { healthy: false, details: { error: err?.message } };
    }
  }
}

/**
 * Factory for storage provider based on environment configuration
 */
export function createStorageProvider(): IStorageProvider {
  if (env.STORAGE_PROVIDER === "R2") {
    return new R2StorageProvider();
  }
  return new LocalStorageProvider();
}

export const storageProvider: IStorageProvider = createStorageProvider();
export default storageProvider;
