import { LoginSchema } from "../../../../validators/auth";
import { loginUser } from "../../../../services/authService";
import { connectToDatabase } from "../../../../config/database";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

    const identifier = parsed.data.emailOrEmployeeId ?? parsed.data.email ?? parsed.data.employeeId ?? "";

    await connectToDatabase();
    const result = await loginUser(identifier, parsed.data.password);
    return success(result);
  } catch (err: any) {
    if (err.message === "INVALID_CREDENTIALS") return error("INVALID_CREDENTIALS", "Invalid email or password", 401);
    if (err.message === "USER_INACTIVE") return error("USER_INACTIVE", "User is inactive", 403);
    console.error("Login error:", err);
    return error("INTERNAL_ERROR", err?.message || "Unable to login", 500);
  }
}
