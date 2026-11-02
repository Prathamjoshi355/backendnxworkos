import { NextResponse } from "next/server";

export function success(data: any, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function error(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export function handleApiError(
  err: unknown,
  fallbackCode = "INTERNAL_SERVER_ERROR",
  fallbackMessage = "Internal error",
  fallbackStatus = 500
) {
  if (err && typeof err === "object") {
    const errorObj = err as any;
    if (errorObj.code === "PASSWORD_CHANGE_REQUIRED" || errorObj.name === "PasswordChangeRequiredError") {
      return error("PASSWORD_CHANGE_REQUIRED", errorObj.message || "Mandatory password change required", 403);
    }
    if (errorObj.code === "DIVISION_FORBIDDEN" || errorObj.name === "DivisionAuthError") {
      return error("FORBIDDEN", errorObj.message, 403);
    }
  }
  const message = err instanceof Error ? err.message : fallbackMessage;
  return error(fallbackCode, message, fallbackStatus);
}
