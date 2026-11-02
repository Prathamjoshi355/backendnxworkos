import { success } from "../../../../utils/response";

export async function GET() {
  return success({
    status: "alive",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
