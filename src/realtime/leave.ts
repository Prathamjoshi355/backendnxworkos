import { getSocket } from "../lib/socket";

export function emitLeaveEvent(
  event: string,
  leave: any,
  scope?: {
    organizationId?: string | null;
    teamId?: string | null;
    userId?: string | null;
    reportingManagerId?: string | null;
  }
) {
  try {
    const socket = getSocket();
    const payload = {
      leaveId: String(leave.leaveId || leave._id || ""),
      userId: String((leave.userId as any)?._id || leave.userId || ""),
      userName: String((leave.userId as any)?.fullName || leave.userName || ""),
      leaveTypeName: String(leave.leaveTypeName || "General Leave"),
      startDate: leave.startDate ? new Date(leave.startDate).toISOString() : "",
      endDate: leave.endDate ? new Date(leave.endDate).toISOString() : "",
      totalDays: Number(leave.totalDays || 0),
      reason: String(leave.reason || ""),
      status: String(leave.status || ""),
      reviewerComment: leave.reviewerComment ? String(leave.reviewerComment) : null,
      organizationId: leave.organizationId ? String(leave.organizationId) : null,
      teamId: leave.teamId ? String(leave.teamId) : null,
      timestamp: new Date().toISOString(),
    };

    if (scope?.organizationId) {
      socket.to(`org:${scope.organizationId}`).emit(event, payload);
      socket.to(`org:${scope.organizationId}`).emit("leave:updated", payload);
    }
    if (scope?.teamId) {
      socket.to(`team:${scope.teamId}`).emit(event, payload);
      socket.to(`team:${scope.teamId}`).emit("leave:updated", payload);
    }
    if (scope?.userId) {
      socket.to(`user:${scope.userId}`).emit(event, payload);
      socket.to(`user:${scope.userId}`).emit("leave:updated", payload);
    }
    if (scope?.reportingManagerId) {
      socket.to(`user:${scope.reportingManagerId}`).emit(event, payload);
      socket.to(`user:${scope.reportingManagerId}`).emit("leave:updated", payload);
    }

    socket.emit(event, payload);
    socket.emit("leave:updated", payload);
  } catch {
    // socket may not be initialized in tests or non-server contexts
  }
}
