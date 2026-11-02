import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import * as productService from "../../../../services/productService";
import { success, error } from "../../../../utils/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await context.params;
  const body = await request.json();
  const updated = await productService.updateProduct(id, String(user.organizationId), body);
  if (!updated) return error("NOT_FOUND", "Product not found", 404);

  return success({ product: updated });
}
