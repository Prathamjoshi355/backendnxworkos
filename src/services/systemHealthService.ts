import mongoose from "mongoose";
import { getSocket } from "../lib/socket";

export interface SystemHealthOptions {
  userRole?: string;
  organizationId?: string | null;
}

export async function getSystemHealth(opts: SystemHealthOptions = {}) {
  const dbStateMap: Record<number, string> = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const dbReadyState = mongoose.connection.readyState;
  const dbStatus = dbStateMap[dbReadyState] || "unknown";

  let socketConnected = false;
  let socketClientCount = 0;

  try {
    const io = getSocket();
    socketConnected = !!io;
    socketClientCount = io.engine?.clientsCount ?? 0;
  } catch (_) {
    socketConnected = false;
    socketClientCount = 0;
  }

  const memory = process.memoryUsage();
  const uptimeSeconds = Math.floor(process.uptime());

  return {
    status: dbReadyState === 1 ? "healthy" : "degraded",
    database: {
      status: dbStatus,
      name: mongoose.connection.name || "nxworkos",
      host: mongoose.connection.host || "localhost",
    },
    system: {
      uptimeSeconds,
      nodeVersion: process.version,
      platform: process.platform,
      environment: process.env.NODE_ENV || "development",
      memoryUsage: {
        rssMb: Math.round((memory.rss / (1024 * 1024)) * 100) / 100,
        heapTotalMb: Math.round((memory.heapTotal / (1024 * 1024)) * 100) / 100,
        heapUsedMb: Math.round((memory.heapUsed / (1024 * 1024)) * 100) / 100,
      },
    },
    realtime: {
      socketEnabled: socketConnected,
      connectedClients: socketClientCount,
    },
    scope: {
      isSuperAdmin: opts.userRole === "SUPER_ADMIN",
      organizationId: opts.organizationId || null,
    },
    timestamp: new Date().toISOString(),
  };
}
