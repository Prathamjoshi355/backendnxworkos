import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../utils/logger";

type Cached = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCached: Cached | undefined;
}

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017/nxplatform";
const MONGODB_URI = process.env.MONGODB_URI || env.MONGODB_URI || DEFAULT_MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable inside env");
}

const cached = global._mongooseCached || (global._mongooseCached = { conn: null, promise: null });

// Setup mongoose event listeners once
if (mongoose.connection.listenerCount("connected") === 0) {
  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connection established successfully");
  });

  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error", { error: err.message });
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB connection disconnected");
  });
}

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI || MONGODB_URI;

  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose;
    return cached.conn;
  }

  if (!cached.promise || mongoose.connection.readyState === 0) {
    const options: mongoose.ConnectOptions = {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      autoIndex: env.NODE_ENV !== "production",
    };

    // Extract DB name from URI path or default to nxplatform if connecting to Atlas/local without explicit DB path
    try {
      const urlObj = new URL(uri.startsWith("mongodb") ? uri.replace("mongodb+srv://", "http://").replace("mongodb://", "http://") : uri);
      const pathname = urlObj.pathname.replace("/", "");
      if (!pathname || pathname === "test") {
        options.dbName = "nxplatform";
      }
    } catch (_) {
      options.dbName = "nxplatform";
    }

    cached.promise = mongoose
      .connect(uri, options)
      .then((m) => {
        return m;
      })
      .catch((err) => {
        logger.error("Failed to connect to MongoDB", { error: err.message });
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    cached.conn = null;
    cached.promise = null;
    logger.info("MongoDB disconnected gracefully");
  }
}
