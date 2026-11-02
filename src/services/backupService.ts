import fs from "fs";
import path from "path";
import crypto from "crypto";
import mongoose from "mongoose";
import { connectToDatabase } from "../config/database";
import { logger } from "../utils/logger";

export interface BackupManifest {
  backupId: string;
  createdAt: string;
  mongodbUri: string;
  collections: Array<{
    name: string;
    count: number;
    sizeBytes: number;
  }>;
  totalCollections: number;
  totalDocuments: number;
  totalSizeBytes: number;
  sha256Checksum: string;
}

export interface BackupResult {
  success: boolean;
  backupId: string;
  backupDirectory: string;
  manifest: BackupManifest;
  durationMs: number;
}

export interface RestoreResult {
  success: boolean;
  backupId: string;
  collectionsRestored: number;
  documentsRestored: number;
  durationMs: number;
  verifiedChecksums: boolean;
}

function calculateChecksum(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export async function executeDatabaseBackup(options: {
  outputBaseDir?: string;
  retentionDays?: number;
} = {}): Promise<BackupResult> {
  const startTime = Date.now();
  await connectToDatabase();

  const baseDir = options.outputBaseDir || path.resolve(process.cwd(), "backups");
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = `backup_${timestamp}`;
  const backupDir = path.join(baseDir, backupId);
  fs.mkdirSync(backupDir, { recursive: true });

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("DATABASE_NOT_CONNECTED: Cannot perform backup without active database connection.");
  }

  const collections = await db.listCollections().toArray();
  const manifestCollections: BackupManifest["collections"] = [];
  let totalDocuments = 0;
  let totalSizeBytes = 0;

  const aggregatedDump: Record<string, any[]> = {};

  for (const colMeta of collections) {
    const colName = colMeta.name;
    // Skip internal system collections
    if (colName.startsWith("system.")) continue;

    const collection = db.collection(colName);
    const docs = await collection.find({}).toArray();
    const count = docs.length;
    const jsonStr = JSON.stringify(docs);
    const sizeBytes = Buffer.byteLength(jsonStr, "utf8");

    fs.writeFileSync(path.join(backupDir, `${colName}.json`), jsonStr, "utf8");

    manifestCollections.push({
      name: colName,
      count,
      sizeBytes,
    });

    aggregatedDump[colName] = docs;
    totalDocuments += count;
    totalSizeBytes += sizeBytes;
  }

  // Calculate cryptographic SHA-256 integrity checksum over the entire snapshot
  const aggregatedStr = JSON.stringify(aggregatedDump);
  const sha256Checksum = calculateChecksum(aggregatedStr);

  const manifest: BackupManifest = {
    backupId,
    createdAt: new Date().toISOString(),
    mongodbUri: "[REDACTED]",
    collections: manifestCollections,
    totalCollections: manifestCollections.length,
    totalDocuments,
    totalSizeBytes,
    sha256Checksum,
  };

  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  // Apply retention policy (purge backups older than retentionDays)
  const retentionDays = options.retentionDays || 7;
  try {
    const allBackups = fs.readdirSync(baseDir);
    const retentionCutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const b of allBackups) {
      const bPath = path.join(baseDir, b);
      const stat = fs.statSync(bPath);
      if (stat.isDirectory() && stat.mtimeMs < retentionCutoff && b.startsWith("backup_")) {
        fs.rmSync(bPath, { recursive: true, force: true });
        logger.info(`Purged expired backup: ${b}`);
      }
    }
  } catch (err: any) {
    logger.warn(`Failed to execute retention cleanup: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  logger.info(`Database backup completed successfully: ${backupId} (${totalDocuments} docs, ${totalSizeBytes} bytes in ${durationMs}ms)`);

  return {
    success: true,
    backupId,
    backupDirectory: backupDir,
    manifest,
    durationMs,
  };
}

export async function restoreDatabaseBackup(
  backupDir: string,
  options: {
    targetMongooseConnection?: typeof mongoose;
    dropExisting?: boolean;
  } = {}
): Promise<RestoreResult> {
  const startTime = Date.now();

  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`INVALID_BACKUP: manifest.json not found in ${backupDir}`);
  }

  const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // 1. Verify backup integrity via SHA-256 Checksum
  const aggregatedDump: Record<string, any[]> = {};
  for (const col of manifest.collections) {
    const colFile = path.join(backupDir, `${col.name}.json`);
    if (!fs.existsSync(colFile)) {
      throw new Error(`CORRUPTED_BACKUP: Missing collection file ${col.name}.json`);
    }
    const docs = JSON.parse(fs.readFileSync(colFile, "utf8"));
    aggregatedDump[col.name] = docs;
  }

  const computedChecksum = calculateChecksum(JSON.stringify(aggregatedDump));
  if (computedChecksum !== manifest.sha256Checksum) {
    throw new Error("BACKUP_INTEGRITY_COMPROMISED: SHA-256 checksum mismatch! Data may be tampered or corrupted.");
  }

  // 2. Perform restoration
  const targetMongoose = options.targetMongooseConnection || mongoose;
  const db = targetMongoose.connection.db;
  if (!db) {
    throw new Error("DATABASE_NOT_CONNECTED: Target connection is not connected.");
  }

  let collectionsRestored = 0;
  let documentsRestored = 0;

  for (const col of manifest.collections) {
    const docs = aggregatedDump[col.name];
    const collection = db.collection(col.name);

    if (options.dropExisting !== false) {
      await collection.deleteMany({});
    }

    if (docs.length > 0) {
      // Re-hydrate ObjectIds and Dates where applicable
      const hydratedDocs = docs.map((d: any) => {
        const copy = { ...d };
        if (copy._id && typeof copy._id === "string" && mongoose.Types.ObjectId.isValid(copy._id)) {
          copy._id = new mongoose.Types.ObjectId(copy._id);
        }
        return copy;
      });
      await collection.insertMany(hydratedDocs);
    }

    collectionsRestored++;
    documentsRestored += docs.length;
  }

  const durationMs = Date.now() - startTime;
  logger.info(`Database restoration completed successfully: ${manifest.backupId} (${documentsRestored} docs restored in ${durationMs}ms)`);

  return {
    success: true,
    backupId: manifest.backupId,
    collectionsRestored,
    documentsRestored,
    durationMs,
    verifiedChecksums: true,
  };
}

