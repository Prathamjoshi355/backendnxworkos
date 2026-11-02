import { env } from "../config/env";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "refreshtoken",
  "authorization",
  "secret",
  "jwt_secret",
  "r2_secret_access_key",
  "r2_access_key_id",
  "aws_secret_access_key",
  "aws_access_key_id",
  "secretaccesskey",
  "accesskeyid",
  "salary",
  "bankaccount",
  "pancard",
  "aadhaarcard",
  "creditcard",
  "cron_secret",
  "nx_cron_secret",
  "database_url",
  "mongodb_uri",
  "cookie",
]);

function redact(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      sanitized[key] = redact(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private currentLevelPriority: number;

  constructor() {
    const configuredLevel = (env.LOG_LEVEL || "info") as LogLevel;
    this.currentLevelPriority = LEVEL_PRIORITY[configuredLevel] ?? 1;
  }

  private log(level: LogLevel, message: string, meta?: any) {
    if (LEVEL_PRIORITY[level] < this.currentLevelPriority) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...(meta ? { metadata: redact(meta) } : {}),
      env: env.NODE_ENV,
    };

    if (env.NODE_ENV === "production") {
      const output = JSON.stringify(payload);
      if (level === "error") {
        console.error(output);
      } else if (level === "warn") {
        console.warn(output);
      } else {
        console.log(output);
      }
    } else {
      // In dev/test, keep clean console output
      const metaStr = meta ? ` ${JSON.stringify(redact(meta))}` : "";
      const msg = `[${payload.timestamp}] [${payload.level}] ${message}${metaStr}`;
      if (level === "error") {
        console.error(msg);
      } else if (level === "warn") {
        console.warn(msg);
      } else if (level === "info") {
        console.log(msg);
      }
    }
  }

  debug(message: string, meta?: any) {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: any) {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: any) {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: any) {
    this.log("error", message, meta);
  }
}

export const logger = new Logger();
