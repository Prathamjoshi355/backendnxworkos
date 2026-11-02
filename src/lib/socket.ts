import Conversation from "../models/Conversation";
import { Server as HTTPServer } from "http";
import { Server as IOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { logger } from "../utils/logger";

let io: IOServer | null = null;

const userSocketCounts = new Map<string, number>();

export function isUserOnline(userId: string): boolean {
  return (userSocketCounts.get(String(userId)) || 0) > 0;
}

export function getOnlineUserIds(): string[] {
  return Array.from(userSocketCounts.keys()).filter((id) => (userSocketCounts.get(id) || 0) > 0);
}


export function initSocket(server: HTTPServer) {
  if (io) return io;
  
  const corsOrigins = env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(",").map((s) => s.trim());

  io = new IOServer(server, {
    cors: {
      origin: corsOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    maxHttpBufferSize: 1e6, // 1MB payload limit for realtime socket packets
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace("Bearer ", "");
    if (!token) {
      return next(new Error("UNAUTHORIZED: Authentication token required for socket connection"));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as any;
      (socket as any).user = decoded;
      next();
    } catch (err: any) {
      logger.warn("Socket handshake token verification failed", { error: err?.message });
      return next(new Error("UNAUTHORIZED: Invalid or expired socket token"));
    }
  });

  io.on("connection", (socket) => {
    const user = (socket as any).user;
    const socketUserId = user?.sub || user?.id || user?.userId || user?._id;

    if (socketUserId) {
      const uId = String(socketUserId);
      const prevCount = userSocketCounts.get(uId) || 0;
      userSocketCounts.set(uId, prevCount + 1);

      // Automatically join user's own room
      socket.join(`user:${uId}`);

      // First device connected: announce online presence to organization
      if (prevCount === 0 && user.organizationId) {
        io?.to(`org:${user.organizationId}`).emit("presence:online", {
          userId: uId,
          timestamp: new Date(),
        });
      }
    }

    socket.on("join:user", (userId?: string) => {
      if (!userId || !user) return;
      // Room Security: Allow user to join own room or if Admin/Super Admin
      if (String(socketUserId) === String(userId) || ["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
        socket.join(`user:${String(userId)}`);
      } else {
        logger.warn("Unauthorized join:user attempt", { socketUserId, targetUserId: userId });
      }
    });

    socket.on("leave:user", (userId?: string) => {
      if (!userId) return;
      socket.leave(`user:${String(userId)}`);
    });

    socket.on("join:org", (orgId?: string) => {
      if (!orgId || !user) return;
      if (user.organizationId === orgId || user.role === "SUPER_ADMIN") {
        socket.join(`org:${String(orgId)}`);
      } else {
        logger.warn("Unauthorized join:org attempt", { socketOrgId: user.organizationId, targetOrgId: orgId });
      }
    });

    socket.on("join:dept", (deptId?: string) => {
      if (!deptId || !user) return;
      if (user.departmentId === deptId || ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
        socket.join(`dept:${String(deptId)}`);
      } else {
        logger.warn("Unauthorized join:dept attempt", { socketDeptId: user.departmentId, targetDeptId: deptId });
      }
    });

    socket.on("join:team", (teamId?: string) => {
      if (!teamId || !user) return;
      if (user.teamId === teamId || ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role)) {
        socket.join(`team:${String(teamId)}`);
      } else {
        logger.warn("Unauthorized join:team attempt", { socketTeamId: user.teamId, targetTeamId: teamId });
      }
    });


    // Secure conversation room joining with server-side authorization
    socket.on("join:conversation", async (conversationId?: string) => {
      if (!conversationId || !user) return;
      try {
        const conv = await Conversation.findOne({
          _id: conversationId,
          organizationId: user.organizationId,
          participants: socketUserId,
        }).select("_id").lean();

        if (conv || user.role === "SUPER_ADMIN") {
          socket.join(`conversation:${String(conversationId)}`);
        } else {
          logger.warn("Unauthorized join:conversation attempt", { socketUserId, conversationId });
        }
      } catch (err: any) {
        logger.error("Error joining conversation room", { error: err.message, conversationId });
      }
    });

    socket.on("leave:conversation", (conversationId?: string) => {
      if (!conversationId) return;
      socket.leave(`conversation:${String(conversationId)}`);
    });

    // Real-time typing indicators
    socket.on("typing:start", (data: { conversationId: string }) => {
      if (!data?.conversationId || !user) return;
      socket.to(`conversation:${data.conversationId}`).emit("typing:start", {
        conversationId: data.conversationId,
        userId: String(socketUserId),
        userName: user.fullName || "Collaborator",
      });
    });

    socket.on("typing:stop", (data: { conversationId: string }) => {
      if (!data?.conversationId || !user) return;
      socket.to(`conversation:${data.conversationId}`).emit("typing:stop", {
        conversationId: data.conversationId,
        userId: String(socketUserId),
      });
    });

    socket.on("disconnect", (reason) => {
      if (socketUserId) {
        const uId = String(socketUserId);
        const currentCount = userSocketCounts.get(uId) || 1;
        if (currentCount <= 1) {
          userSocketCounts.delete(uId);
          if (user.organizationId) {
            io?.to(`org:${user.organizationId}`).emit("presence:offline", {
              userId: uId,
              lastActiveAt: new Date(),
            });
          }
        } else {
          userSocketCounts.set(uId, currentCount - 1);
        }
      }
      logger.debug("Socket disconnected", { socketId: socket.id, reason });
    });
  });

  return io;
}

export function getSocket() {
  if (!io) throw new Error("Socket not initialized");
  return io;
}

export function closeSocket(): Promise<void> {
  return new Promise((resolve) => {
    if (io) {
      io.close(() => {
        io = null;
        logger.info("Socket.IO server closed gracefully");
        resolve();
      });
    } else {
      resolve();
    }
  });
}
