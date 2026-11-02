import mongoose from "mongoose";
import { connectToDatabase } from "../../../../config/database";
import { getSocket } from "../../../../lib/socket";
import { storageProvider } from "../../../../services/storageService";
import { success, error } from "../../../../utils/response";

export async function GET() {
  try {
    await connectToDatabase();
    const dbReady = mongoose.connection.readyState === 1;

    let socketReady = false;
    try {
      const io = getSocket();
      socketReady = !!io;
    } catch (_) {
      socketReady = false;
    }

    let storageReady = false;
    try {
      const storageHealth = await storageProvider.healthCheck();
      storageReady = storageHealth.healthy;
    } catch (_) {
      storageReady = false;
    }

    if (!dbReady) {
      return error("NOT_READY", "Database connection is not ready", 503);
    }

    return success({
      status: "ready",
      database: {
        status: "connected",
        readyState: mongoose.connection.readyState,
      },
      realtime: {
        socketReady,
      },
      storage: {
        provider: storageProvider.providerName,
        ready: storageReady,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Service not ready";
    return error("NOT_READY", message, 503);
  }
}
