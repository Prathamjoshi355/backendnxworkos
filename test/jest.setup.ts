import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { R2Client } from '../src/services/storage/r2Client';

jest.setTimeout(120000);

const localBinDir = path.resolve(__dirname, '../.cache/mongodb-binaries');
process.env.MONGOMS_DOWNLOAD_DIR = localBinDir;

MongoMemoryServer.config = {
  binary: {
    version: '7.0.14',
    downloadDir: localBinDir,
  },
  instance: {
    ip: '127.0.0.1',
    port: 0,
    dbName: 'nxplatform-test',
    storageEngine: 'wiredTiger',
  },
};

// Global in-memory storage for R2 in test environment to avoid real network timeouts
const mockGlobalR2Storage = new Map<string, { buffer: Buffer; mimeType: string; mtime: Date }>();

jest.spyOn(R2Client.prototype, 'putObject').mockImplementation(async function (
  key: string,
  body: Buffer,
  mimeType: string = 'application/octet-stream'
) {
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  mockGlobalR2Storage.set(cleanKey, { buffer: body, mimeType, mtime: new Date() });
});

jest.spyOn(R2Client.prototype, 'getObject').mockImplementation(async function (key: string) {
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  const item = mockGlobalR2Storage.get(cleanKey);
  if (!item) throw new Error('R2_OBJECT_NOT_FOUND');
  return { buffer: item.buffer, size: item.buffer.length, mimeType: item.mimeType };
});

jest.spyOn(R2Client.prototype, 'deleteObject').mockImplementation(async function (key: string) {
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  return mockGlobalR2Storage.delete(cleanKey);
});

jest.spyOn(R2Client.prototype, 'headObject').mockImplementation(async function (key: string) {
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  const item = mockGlobalR2Storage.get(cleanKey);
  if (!item) return null;
  return { size: item.buffer.length, mtime: item.mtime, mimeType: item.mimeType };
});
