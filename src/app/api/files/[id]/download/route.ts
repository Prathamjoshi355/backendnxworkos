import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest } from "../../../../../middleware/auth";
import * as fileService from "../../../../../services/fileService";
import { error } from "../../../../../utils/response";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

    const resolvedParams = await context.params;
    const fileId = resolvedParams.id;

    const fileDownload = await fileService.downloadFile(user, fileId);

    return new Response(new Uint8Array(fileDownload.buffer), {
      status: 200,
      headers: {
        "Content-Type": fileDownload.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileDownload.originalName)}"`,
        "Content-Length": String(fileDownload.size),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Unable to download file";
    if (msg === "FILE_NOT_FOUND") {
      return error("NOT_FOUND", "File not found", 404);
    }
    if (msg === "FORBIDDEN_FILE_DOWNLOAD") {
      return error("FORBIDDEN", "Forbidden - unauthorized file download", 403);
    }
    return error("DOWNLOAD_FAILED", msg, 500);
  }
}
