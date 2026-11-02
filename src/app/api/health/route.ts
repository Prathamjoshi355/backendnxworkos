import { connectToDatabase } from "../../../config/database";
import { success, error } from "../../../utils/response";

export async function GET() {
  try {
    await connectToDatabase();
    return success({
      status: "healthy",
      api: "ok",
      mongodb: "connected",
      serverTime: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "MongoDB connection failed";
    return error("DB_ERROR", message, 500);
  }
}
