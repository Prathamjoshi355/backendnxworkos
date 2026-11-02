import { NextResponse } from "next/server";
import { RegisterSchema } from "../../../../validators/auth";
import { registerUser } from "../../../../services/authService";
import { connectToDatabase } from "../../../../config/database";
import { error, success } from "../../../../utils/response";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) return error("VALIDATION_ERROR", parsed.error.message, 422);

    await connectToDatabase();

    const user = await registerUser(parsed.data as any);
    return success({ user });
  } catch (err: any) {
    if (err.message === "EMAIL_EXISTS") return error("EMAIL_EXISTS", "Email already registered", 409);
    console.error(err);
    return error("INTERNAL_ERROR", "Unable to register user", 500);
  }
}
