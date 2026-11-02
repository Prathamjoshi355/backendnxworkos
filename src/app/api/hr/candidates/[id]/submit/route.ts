import { connectToDatabase } from "../../../../../../config/database";
import { getUserFromRequest } from "../../../../../../middleware/auth";
import { success, error } from "../../../../../../utils/response";
import * as candidateService from "../../../../../../services/candidateOfferService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const user = await getUserFromRequest(request);
    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";

    let fileBuffer: Buffer;
    let fileName: string;
    let mimeType: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File;
      if (!file) return error("VALIDATION_ERROR", "No file uploaded", 422);
      fileName = file.name;
      mimeType = file.type || "application/pdf";
      fileBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      const body = await request.json();
      if (!body.base64 || !body.fileName) {
        return error("VALIDATION_ERROR", "fileName and base64 payload required", 422);
      }
      fileName = body.fileName;
      mimeType = body.mimeType || "application/pdf";
      fileBuffer = Buffer.from(body.base64, "base64");
    }

    const candidate = await candidateService.submitSignedOffer(
      id,
      { buffer: fileBuffer, fileName, mimeType },
      user
    );

    return success({ candidate, message: "Signed offer document submitted successfully" });
  } catch (err: any) {
    if (err.message.startsWith("OFFER_EXPIRED")) {
      return error("OFFER_EXPIRED", err.message, 410);
    }
    if (err.message.startsWith("CANDIDATE_NOT_FOUND")) {
      return error("NOT_FOUND", err.message, 404);
    }
    return error("FAILED", err.message, 500);
  }
}

