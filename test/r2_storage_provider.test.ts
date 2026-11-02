import crypto from "crypto";
import { R2StorageProvider, LocalStorageProvider, IStorageProvider } from "../src/services/storageService";
import { R2Client } from "../src/services/storage/r2Client";

describe("TASK 19: Cloudflare R2 Storage Provider & Migration Test Suite", () => {
  let mockR2Storage: Map<string, { buffer: Buffer; mimeType: string; mtime: Date }>;
  let mockClient: R2Client;
  let r2Provider: R2StorageProvider;

  beforeEach(() => {
    mockR2Storage = new Map();

    // Create a mockable R2Client for deterministic unit tests
    mockClient = new R2Client({
      accountId: "test-cf-account-12345",
      accessKeyId: "test-r2-access-key-id",
      secretAccessKey: "test-r2-secret-access-key",
      bucketName: "test-nxworkos-private-bucket",
    });

    // Mock network methods on mockClient
    jest.spyOn(mockClient, "putObject").mockImplementation(async (key: string, body: Buffer, mimeType: string = "application/octet-stream") => {
      mockR2Storage.set(key, { buffer: body, mimeType, mtime: new Date() });
    });

    jest.spyOn(mockClient, "getObject").mockImplementation(async (key: string) => {
      const item = mockR2Storage.get(key);
      if (!item) throw new Error("R2_OBJECT_NOT_FOUND");
      return { buffer: item.buffer, size: item.buffer.length, mimeType: item.mimeType };
    });

    jest.spyOn(mockClient, "deleteObject").mockImplementation(async (key: string) => {
      return mockR2Storage.delete(key);
    });

    jest.spyOn(mockClient, "headObject").mockImplementation(async (key: string) => {
      const item = mockR2Storage.get(key);
      if (!item) return null;
      return { size: item.buffer.length, mtime: item.mtime, mimeType: item.mimeType };
    });

    r2Provider = new R2StorageProvider(mockClient);
  });

  describe("1. Deterministic Tenant-Isolated Object Key Strategy", () => {
    it("generates deterministic, structured tenant object key", () => {
      const key = r2Provider.generateObjectKey({
        organizationId: "org_alpha_101",
        employeeId: "emp_alice_202",
        fileId: "file_doc_303",
        fileName: "Quarterly_Performance_Review.pdf",
      });

      expect(key).toMatch(/^organizations\/org_alpha_101\/employees\/emp_alice_202\/documents\/file_doc_303\/\d+_Quarterly_Performance_Review\.pdf$/);
    });

    it("sanitizes path traversal and illegal characters in object keys", () => {
      const key = r2Provider.generateObjectKey({
        organizationId: "../../org_malicious",
        employeeId: "emp/../../root",
        fileId: "file..bad",
        fileName: "../../../etc/passwd.txt",
      });

      expect(key).not.toContain("/../");
      expect(key).not.toContain("etc/passwd");
      expect(key).toMatch(/^organizations\/___org_malicious\/employees\/emp_____root\/documents\/file__bad\/\d+_passwd\.txt$/);
    });
  });

  describe("2. Binary Document Persistence & Checksum in Cloudflare R2", () => {
    it("uploads binary payload to Cloudflare R2 and computes SHA-256 checksum", async () => {
      const documentContent = "Confidential NexisparkX Enterprise Strategy Document 2026";
      const expectedChecksum = crypto.createHash("sha256").update(documentContent).digest("hex");

      const uploadResult = await r2Provider.upload({
        buffer: documentContent,
        fileName: "strategy.pdf",
        mimeType: "application/pdf",
        organizationId: "org_alpha_101",
        employeeId: "emp_alice_202",
        fileId: "file_strategy_1",
      });

      expect(uploadResult.storageProvider).toBe("R2");
      expect(uploadResult.bucket).toBe("test-nxworkos-private-bucket");
      expect(uploadResult.checksum).toBe(expectedChecksum);
      expect(uploadResult.fileSize).toBe(Buffer.byteLength(documentContent));
      expect(uploadResult.objectKey).toBeDefined();

      // Verify object exists in R2 storage
      const exists = await r2Provider.exists(uploadResult.objectKey!);
      expect(exists).toBe(true);

      // Verify read-back binary content matches original bytes byte-for-byte
      const downloaded = await r2Provider.read(uploadResult.objectKey!);
      expect(downloaded.buffer.toString("utf-8")).toBe(documentContent);
      expect(downloaded.size).toBe(uploadResult.fileSize);
    });

    it("handles base64 data URLs correctly", async () => {
      const rawText = "Binary payload from base64 string";
      const base64Input = `data:application/pdf;base64,${Buffer.from(rawText).toString("base64")}`;
      const expectedChecksum = crypto.createHash("sha256").update(rawText).digest("hex");

      const res = await r2Provider.upload({
        buffer: base64Input,
        fileName: "contract.pdf",
        organizationId: "org_beta",
        fileId: "file_base64_1",
      });

      expect(res.checksum).toBe(expectedChecksum);
      const readBack = await r2Provider.read(res.objectKey!);
      expect(readBack.buffer.toString("utf-8")).toBe(rawText);
    });
  });

  describe("3. Presigned Short-Lived Download URLs", () => {
    it("generates presigned AWS SigV4 URL with expiration parameter", async () => {
      const key = "organizations/org_1/employees/emp_1/documents/file_1/doc.pdf";
      const signedUrl = await r2Provider.getSignedDownloadUrl(key, 900);

      expect(signedUrl).toContain("https://test-cf-account-12345.r2.cloudflarestorage.com");
      expect(signedUrl).toContain("test-nxworkos-private-bucket");
      expect(signedUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
      expect(signedUrl).toContain("X-Amz-Expires=900");
      expect(signedUrl).toContain("X-Amz-Signature=");
    });
  });

  describe("4. Delete & Object Lifecycle", () => {
    it("deletes object from R2 and verifies non-existence", async () => {
      const uploadRes = await r2Provider.upload({
        buffer: "Temp document for deletion",
        fileName: "temp.txt",
        organizationId: "org_alpha",
        fileId: "file_temp",
      });

      expect(await r2Provider.exists(uploadRes.objectKey!)).toBe(true);

      const deleted = await r2Provider.delete(uploadRes.objectKey!);
      expect(deleted).toBe(true);

      expect(await r2Provider.exists(uploadRes.objectKey!)).toBe(false);
    });
  });

  describe("5. Health Check & Error Handling", () => {
    it("returns healthy status on valid client configuration", async () => {
      jest.spyOn(mockClient, "healthCheck").mockResolvedValue({ healthy: true, details: { bucket: "test-bucket" } });
      const health = await r2Provider.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it("throws R2_OBJECT_NOT_FOUND when reading missing key", async () => {
      await expect(r2Provider.read("organizations/org/missing.pdf")).rejects.toThrow("R2_OBJECT_NOT_FOUND");
    });
  });

  describe("6. Local Storage Provider (Development Fallback)", () => {
    let localProvider: LocalStorageProvider;

    beforeAll(() => {
      localProvider = new LocalStorageProvider();
    });

    it("local provider implements IStorageProvider interface with providerName LOCAL", () => {
      expect(localProvider.providerName).toBe("LOCAL");
    });
  });
});
