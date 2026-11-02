import crypto from "crypto";
import { logger } from "../../utils/logger";

export interface R2Config {
  accountId?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint?: string;
  publicUrl?: string;
}

export class R2Client {
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;
  private endpoint: string;
  private region: string = "auto";
  private service: string = "s3";

  constructor(config: R2Config) {
    this.accessKeyId = config.accessKeyId || "";
    this.secretAccessKey = config.secretAccessKey || "";
    this.bucketName = config.bucketName || "";

    if (config.endpoint) {
      this.endpoint = config.endpoint.replace(/\/$/, "");
    } else if (config.accountId) {
      this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    } else {
      this.endpoint = "https://r2.cloudflarestorage.com";
    }
  }

  public getBucketName(): string {
    return this.bucketName;
  }

  public getEndpoint(): string {
    return this.endpoint;
  }

  private hmac(key: Buffer | string, string: string): Buffer {
    return crypto.createHmac("sha256", key).update(string, "utf8").digest();
  }

  private hash(stringOrBuffer: string | Buffer): string {
    return crypto.createHash("sha256").update(stringOrBuffer).digest("hex");
  }

  private getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = this.hmac("AWS4" + key, dateStamp);
    const kRegion = this.hmac(kDate, regionName);
    const kService = this.hmac(kRegion, serviceName);
    const kSigning = this.hmac(kService, "aws4_request");
    return kSigning;
  }

  /**
   * Generates AWS SigV4 signed headers for REST request
   */
  private signRequest(
    method: string,
    canonicalUri: string,
    canonicalQueryString: string,
    headers: Record<string, string>,
    payloadHash: string
  ): { authHeader: string; amzDate: string } {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.substring(0, 8);

    const signedHeadersList: string[] = ["host", "x-amz-content-sha256", "x-amz-date"];
    const headerMap: Record<string, string> = {
      ...headers,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    };

    const host = new URL(this.endpoint).host;
    headerMap["host"] = host;

    const sortedSignedHeaders = signedHeadersList.sort().join(";");
    const canonicalHeaders = signedHeadersList
      .sort()
      .map((h) => `${h}:${headerMap[h].trim()}\n`)
      .join("");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      sortedSignedHeaders,
      payloadHash,
    ].join("\n");

    const algorithm = "AWS4-HMAC-SHA256";
    const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const stringToSign = [algorithm, amzDate, credentialScope, this.hash(canonicalRequest)].join("\n");

    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, this.service);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    const authHeader = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${sortedSignedHeaders}, Signature=${signature}`;

    return { authHeader, amzDate };
  }

  /**
   * Upload an object to Cloudflare R2
   */
  async putObject(key: string, body: Buffer, mimeType: string = "application/octet-stream"): Promise<void> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    const canonicalUri = `/${this.bucketName}/${cleanKey}`;
    const payloadHash = this.hash(body);
    const url = `${this.endpoint}${canonicalUri}`;

    const { authHeader, amzDate } = this.signRequest("PUT", canonicalUri, "", {}, payloadHash);

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(body.length),
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          Authorization: authHeader,
        },
        body: body as any,
      });

      if (!response.ok && response.status !== 200 && response.status !== 201) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`R2_PUT_OBJECT_FAILED: HTTP ${response.status} - ${errorText}`);
      }
    } catch (err: any) {
      logger.error("R2 putObject error", { key: cleanKey, error: err?.message });
      throw err;
    }
  }

  /**
   * Retrieve an object buffer from Cloudflare R2
   */
  async getObject(key: string): Promise<{ buffer: Buffer; size: number; mimeType?: string }> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    const canonicalUri = `/${this.bucketName}/${cleanKey}`;
    const payloadHash = this.hash("");
    const url = `${this.endpoint}${canonicalUri}`;

    const { authHeader, amzDate } = this.signRequest("GET", canonicalUri, "", {}, payloadHash);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          Authorization: authHeader,
        },
      });

      if (response.status === 404) {
        throw new Error("R2_OBJECT_NOT_FOUND");
      }

      if (!response.ok) {
        throw new Error(`R2_GET_OBJECT_FAILED: HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = response.headers.get("content-type") || "application/octet-stream";

      return {
        buffer,
        size: buffer.length,
        mimeType,
      };
    } catch (err: any) {
      logger.error("R2 getObject error", { key: cleanKey, error: err?.message });
      throw err;
    }
  }

  /**
   * Delete an object from Cloudflare R2
   */
  async deleteObject(key: string): Promise<boolean> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    const canonicalUri = `/${this.bucketName}/${cleanKey}`;
    const payloadHash = this.hash("");
    const url = `${this.endpoint}${canonicalUri}`;

    const { authHeader, amzDate } = this.signRequest("DELETE", canonicalUri, "", {}, payloadHash);

    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          Authorization: authHeader,
        },
      });

      return response.ok || response.status === 204 || response.status === 404;
    } catch (err: any) {
      logger.error("R2 deleteObject error", { key: cleanKey, error: err?.message });
      return false;
    }
  }

  /**
   * Check if an object exists in Cloudflare R2
   */
  async headObject(key: string): Promise<{ size: number; mtime: Date; mimeType?: string } | null> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    const canonicalUri = `/${this.bucketName}/${cleanKey}`;
    const payloadHash = this.hash("");
    const url = `${this.endpoint}${canonicalUri}`;

    const { authHeader, amzDate } = this.signRequest("HEAD", canonicalUri, "", {}, payloadHash);

    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          Authorization: authHeader,
        },
      });

      if (response.status === 404 || !response.ok) {
        return null;
      }

      const contentLength = Number(response.headers.get("content-length")) || 0;
      const lastModified = response.headers.get("last-modified");
      const mimeType = response.headers.get("content-type") || undefined;

      return {
        size: contentLength,
        mtime: lastModified ? new Date(lastModified) : new Date(),
        mimeType,
      };
    } catch {
      return null;
    }
  }

  /**
   * Generate short-lived presigned download URL for Cloudflare R2
   */
  getPresignedUrl(key: string, expiresInSeconds: number = 900): string {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.substring(0, 8);
    const host = new URL(this.endpoint).host;

    const canonicalUri = `/${this.bucketName}/${cleanKey}`;
    const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;

    const queryParams: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${encodeURIComponent(this.accessKeyId)}%2F${encodeURIComponent(credentialScope)}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresInSeconds),
      "X-Amz-SignedHeaders": "host",
    };

    const canonicalQueryString = Object.keys(queryParams)
      .sort()
      .map((k) => `${k}=${queryParams[k]}`)
      .join("&");

    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = [
      "GET",
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const algorithm = "AWS4-HMAC-SHA256";
    const stringToSign = [algorithm, amzDate, credentialScope, this.hash(canonicalRequest)].join("\n");

    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, this.service);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    return `${this.endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }

  /**
   * Connectivity and bucket health check
   */
  async healthCheck(): Promise<{ healthy: boolean; details?: any }> {
    if (!this.accessKeyId || !this.secretAccessKey || !this.bucketName) {
      return { healthy: false, details: "Missing R2 credentials or bucket name" };
    }

    try {
      // Test HEAD bucket
      const canonicalUri = `/${this.bucketName}`;
      const payloadHash = this.hash("");
      const url = `${this.endpoint}${canonicalUri}`;
      const { authHeader, amzDate } = this.signRequest("HEAD", canonicalUri, "", {}, payloadHash);

      const response = await fetch(url, {
        method: "HEAD",
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          Authorization: authHeader,
        },
      });

      const healthy = response.ok || response.status === 200 || response.status === 404;
      return {
        healthy,
        details: {
          bucket: this.bucketName,
          endpoint: this.endpoint,
          status: response.status,
        },
      };
    } catch (err: any) {
      return {
        healthy: false,
        details: {
          error: err?.message || "R2 health probe failed",
          bucket: this.bucketName,
        },
      };
    }
  }
}
