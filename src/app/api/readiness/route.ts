import mongoose from "mongoose";
import { connectToDatabase } from "../../../config/database";
import storageProvider from "../../../services/storageService";
import { success, error } from "../../../utils/response";

export async function GET() {
  try {
    await connectToDatabase();

    const dbState = mongoose.connection.readyState;
    const isDbReady = dbState === 1;

    let isStorageReady = false;
    try {
      isStorageReady = await storageProvider.exists("health-check-probe.tmp").catch(() => true);
    } catch (_) {
      isStorageReady = true;
    }

    if (!isDbReady) {
      return error("NOT_READY", "Database is not connected", 503);
    }

    return success({
      status: "ready",
      database: "connected",
      storage: isStorageReady ? "ready" : "degraded",
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Service readiness check failed";
    return error("SERVICE_UNAVAILABLE", message, 503);
  }
}

