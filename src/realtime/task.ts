import { getSocket } from "../lib/socket";

export function emitTaskEvent(
  event: string,
  task: any,
  scope?: { organizationId?: string | null; teamId?: string | null; userId?: string | null }
) {
  try {
    const socket = getSocket();
    const payload = {
      taskId: String(task.taskId || task._id || ""),
      title: String(task.title || ""),
      assignedTo: String((task.assignedTo as any)?._id || task.assignedTo || ""),
      assignedBy: String((task.assignedBy as any)?._id || task.assignedBy || ""),
      status: String(task.status || ""),
      priority: String(task.priority || "MEDIUM"),
      organizationId: task.organizationId ? String(task.organizationId) : null,
      teamId: task.teamId ? String(task.teamId) : null,
      timestamp: new Date().toISOString(),
    };
    if (scope?.organizationId) {
      socket.to(`org:${scope.organizationId}`).emit(event, payload);
    }
    if (scope?.teamId) {
      socket.to(`team:${scope.teamId}`).emit(event, payload);
    }
    if (scope?.userId) {
      socket.to(`user:${scope.userId}`).emit(event, payload);
    }
    socket.emit(event, payload);
  } catch {
    // socket may not be initialized in tests or non-server contexts
  }
}
