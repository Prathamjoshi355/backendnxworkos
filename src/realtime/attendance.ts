import { getSocket } from "../lib/socket";

export function emitAttendanceEvent(event: string, payload: Record<string, unknown>, scope?: { organizationId?: string | null; teamId?: string | null; userId?: string | null }) {
  try {
    const socket = getSocket();
    if (scope?.organizationId) {
      socket.to(`org:${scope.organizationId}`).emit(event, payload);
    }
    if (scope?.teamId) {
      socket.to(`team:${scope.teamId}`).emit(event, payload);
    }
    if (scope?.userId) {
      socket.to(`user:${scope.userId}`).emit(event, payload);
    }
    // Also emit to default namespace for backward compatibility
    socket.emit(event, payload);
  } catch {
    // socket may not be initialized in tests or non-server contexts
  }
}

export function buildAttendanceSocketPayload(user: any, status: string) {
  return {
    userId: String(user?._id || user?.id || ""),
    employeeId: user?.employeeId || "",
    fullName: user?.fullName || "",
    employmentType: user?.employmentType || "EMPLOYEE",
    role: user?.role || "EMPLOYEE",
    organizationId: user?.organizationId ? String(user.organizationId) : null,
    departmentId: user?.departmentId ? String(user.departmentId) : null,
    teamId: user?.teamId ? String(user.teamId) : null,
    status,
    timestamp: new Date().toISOString(),
  };
}
