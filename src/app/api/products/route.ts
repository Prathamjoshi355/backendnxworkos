import { connectToDatabase } from "../../../config/database";
import { getUserFromRequest } from "../../../middleware/auth";
import * as productService from "../../../services/productService";
import { success, error } from "../../../utils/response";

export async function GET(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  const products = await productService.listProducts(String(user.organizationId));
  return success({ products });
}

export async function POST(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user || !user.organizationId) return error("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json();
  if (!body.name || !body.code) {
    return error("VALIDATION_ERROR", "Product name and code are required", 422);
  }

  try {
    const product = await productService.createProduct({
      organizationId: String(user.organizationId),
      name: body.name,
      code: body.code,
      description: body.description,
      status: body.status,
    });
    return success({ product });
  } catch (err: any) {
    return error("PRODUCT_CREATE_FAILED", err.message || "Failed to create product", 500);
  }
}
