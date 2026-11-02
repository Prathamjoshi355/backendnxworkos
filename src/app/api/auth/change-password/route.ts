import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { ChangePasswordSchema } from "../../../../validators/auth";
import { changePassword } from "../../../../services/authService";
import { success, error } from "../../../../utils/response";

export async function POST(request: Request) {
  try {
    await connectToDatabase();

    const user = await getUserFromRequest(request, { allowPendingPasswordChange: true });
    if (!user) {
      return error("UNAUTHORIZED", "Authentication required to change password", 401);
    }

    const body = await request.json();
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return error("VALIDATION_ERROR", parsed.error.issues[0]?.message || "Validation failed", 422);
    }

    const updatedUser = await changePassword({
      userId: String(user._id),
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      confirmPassword: parsed.data.confirmPassword,
    });

    return success({
      message: "Password changed successfully.",
      user: updatedUser,
    });
  } catch (err: any) {
    if (err.message === "INVALID_CURRENT_PASSWORD") {
      return error("INVALID_CURRENT_PASSWORD", "The current password provided is incorrect.", 400);
    }
    if (err.message?.startsWith("WEAK_PASSWORD")) {
      return error("WEAK_PASSWORD", err.message, 422);
    }
    if (err.message === "PASSWORD_CONFIRMATION_MISMATCH") {
      return error("PASSWORD_CONFIRMATION_MISMATCH", "New password and confirm password do not match.", 422);
    }
    if (err.message === "NEW_PASSWORD_SAME_AS_CURRENT") {
      return error("NEW_PASSWORD_SAME_AS_CURRENT", "New password cannot be identical to current password.", 422);
    }

    console.error("Change password error:", err);
    return error("INTERNAL_ERROR", err?.message || "Failed to change password", 500);
  }
}

