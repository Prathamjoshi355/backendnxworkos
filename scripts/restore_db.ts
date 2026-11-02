import path from "path";
import { restoreDatabaseBackup } from "../src/services/backupService";
import { connectToDatabase, disconnectDatabase } from "../src/config/database";

async function main() {
  const backupFolder = process.argv[2];
  if (!backupFolder) {
    console.error("Usage: npx ts-node scripts/restore_db.ts <backup_directory_or_id>");
    process.exit(1);
  }

  const backupPath = path.isAbsolute(backupFolder)
    ? backupFolder
    : path.resolve(process.cwd(), "backups", backupFolder);

  try {
    console.log(`[RESTORE] Starting restoration from ${backupPath}...`);
    await connectToDatabase();
    const result = await restoreDatabaseBackup(backupPath, { dropExisting: true });
    console.log("[RESTORE] Success!");
    console.log("[RESTORE] Backup ID:", result.backupId);
    console.log("[RESTORE] Collections restored:", result.collectionsRestored);
    console.log("[RESTORE] Documents restored:", result.documentsRestored);
    console.log(`[RESTORE] Duration: ${result.durationMs}ms`);
    await disconnectDatabase();
    process.exit(0);
  } catch (err: any) {
    console.error("[RESTORE] Error restoring backup:", err.message);
    process.exit(1);
  }
}

main();

