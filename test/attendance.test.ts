import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../src/models/User';
import { connectToDatabase, disconnectDatabase } from '../src/config/database';
import { registerUser } from '../src/services/authService';
import { loginAttendance, logoutAttendance, startBreak, endBreak } from '../src/services/attendanceService';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-attendance-test' },
  });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.JWT_SECRET = '__test_jwt_secret__';
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
  if (mongo) await mongo.stop();
});

afterEach(async () => {
  const collections = await (await import('../src/models/Attendance')).default.deleteMany({});
  await (await import('../src/models/WorkSession')).default.deleteMany({});
  await (await import('../src/models/Break')).default.deleteMany({});
  await User.deleteMany({});
});

test('first login creates attendance and active work session', async () => {
  const user = await registerUser({ fullName: 'Alice', email: 'alice@example.com', password: 'Password123' });
  const result = await loginAttendance((user as any)._id || (await User.findOne({ email: 'alice@example.com' }).lean())?._id, 'WEB');

  expect(result.attendance.currentStatus).toBe('ONLINE');
  expect(result.session.status).toBe('ACTIVE');
  expect(result.attendance.attendanceStatus).toBeTruthy();
});

test('duplicate login is rejected', async () => {
  const created = await registerUser({ fullName: 'Bob', email: 'bob@example.com', password: 'Password123' });
  const userId = (created as any)._id || (await User.findOne({ email: 'bob@example.com' }).lean())?._id;
  await loginAttendance(userId, 'WEB');

  await expect(loginAttendance(userId, 'MOBILE')).rejects.toThrow('ACTIVE_SESSION_EXISTS');
});

test('logout closes active session and sets user offline', async () => {
  const created = await registerUser({ fullName: 'Carol', email: 'carol@example.com', password: 'Password123' });
  const userId = (created as any)._id || (await User.findOne({ email: 'carol@example.com' }).lean())?._id;
  await loginAttendance(userId, 'WEB');

  const result = await logoutAttendance(userId);
  expect(result.attendance.currentStatus).toBe('OFFLINE');
  expect(result.session.status).toBe('COMPLETED');
});

test('break start and end updates status and duration', async () => {
  const created = await registerUser({ fullName: 'Dana', email: 'dana@example.com', password: 'Password123' });
  const userId = (created as any)._id || (await User.findOne({ email: 'dana@example.com' }).lean())?._id;
  await loginAttendance(userId, 'WEB');

  const started = await startBreak(userId, 'LUNCH');
  expect(started.attendance.currentStatus).toBe('ON_BREAK');
  expect(started.break.status).toBe('ACTIVE');

  const ended = await endBreak(userId);
  expect(ended.attendance.currentStatus).toBe('ONLINE');
  expect(ended.break.status).toBe('COMPLETED');
});
