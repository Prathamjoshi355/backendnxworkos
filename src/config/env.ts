import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/nxplatform"),
  CLIENT_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default("*"),
  JWT_SECRET: z.string().min(1).default(process.env.NODE_ENV === "test" ? "__test_jwt_secret__" : "nexisparkx-jwt-secret-key-2026-production-hardening"),
  UPLOAD_MAX_BYTES: z.coerce.number().default(15 * 1024 * 1024), // 15MB
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 min
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Storage Provider configuration (R2 is default for production)
  STORAGE_PROVIDER: z.enum(["R2", "LOCAL"]).default("R2"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
  throw new Error(`Invalid environment configuration: ${errors}`);
}

const validatedEnv = parsed.data;

// Fail-closed validation in production
if (validatedEnv.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    throw new Error("JWT_SECRET must be explicitly set and at least 16 characters in production");
  }
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes("127.0.0.1") || process.env.MONGODB_URI.includes("localhost")) {
    console.warn("[SECURITY WARNING] Running in production mode with a local MongoDB URI");
  }
  if (validatedEnv.CORS_ORIGIN === "*") {
    console.warn("[SECURITY WARNING] CORS_ORIGIN is set to '*' in production. Consider restricting to specific client origins.");
  }
  if (validatedEnv.STORAGE_PROVIDER === "R2") {
    const hasEndpoint = !!(process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID);
    const hasKey = !!process.env.R2_ACCESS_KEY_ID;
    const hasSecret = !!process.env.R2_SECRET_ACCESS_KEY;
    const hasBucket = !!process.env.R2_BUCKET_NAME;

    if (!hasEndpoint || !hasKey || !hasSecret || !hasBucket) {
      throw new Error(
        "Cloudflare R2 configuration is missing in production. Required: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_ACCOUNT_ID / R2_ENDPOINT"
      );
    }
  }
}

export const env = validatedEnv;
export type Env = typeof env;
