import { executeDatabaseBackup } from "../src/services/backupService";
import { connectToDatabase, disconnectDatabase } from "../src/config/database";

async function main() {
  try {
    console.log("[BACKUP] Starting automated database backup...");
    await connectToDatabase();
    const result = await executeDatabaseBackup();
    console.log("[BACKUP] Success! Backup ID:", result.backupId);
    console.log("[BACKUP] Location:", result.backupDirectory);
    console.log("[BACKUP] Documents:", result.manifest.totalDocuments);
    console.log("[BACKUP] SHA-256:", result.manifest.sha256Checksum);
    await disconnectDatabase();
    process.exit(0);
  } catch (err: any) {
    console.error("[BACKUP] Error executing backup:", err.message);
    process.exit(1);
  }
}

main();

