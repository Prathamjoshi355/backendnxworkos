import { getSocket } from "../lib/socket";

export function emitLeadEvent(event: string, payload: Record<string, unknown>) {
  try {
    const socket = getSocket();
    socket.emit(event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // socket may not be initialized in non-server contexts
  }
}
