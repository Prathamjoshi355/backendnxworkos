import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { registerUser, loginUser, verifyToken } from '../src/services/authService';
import User from '../src/models/User';
import { connectToDatabase, disconnectDatabase } from '../src/config/database';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-auth-test' },
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
  await User.deleteMany({});
});

test('registration success', async () => {
  const user = await registerUser({ fullName: 'Alice', email: 'alice@example.com', password: 'Password123' });
  expect(user.email).toBe('alice@example.com');
  const found = await User.findOne({ email: 'alice@example.com' }).lean();
  expect(found).toBeTruthy();
});

test('duplicate email', async () => {
  await registerUser({ fullName: 'Bob', email: 'bob@example.com', password: 'Password123' });
  await expect(registerUser({ fullName: 'Bob2', email: 'bob@example.com', password: 'Password123' })).rejects.toThrow('EMAIL_EXISTS');
});

test('invalid email registration should be caught by validator (not service)', async () => {
  // service assumes validation happened earlier — this is a smoke check
  await expect(registerUser({ fullName: 'X', email: 'not-an-email', password: 'pass' })).resolves.toBeTruthy();
});

test('login success and token verification', async () => {
  await registerUser({ fullName: 'Carol', email: 'carol@example.com', password: 'Password123' });
  const res = await loginUser('carol@example.com', 'Password123');
  expect(res.token).toBeTruthy();
  const payload = verifyToken(res.token);
  expect(payload).toBeTruthy();
});

test('incorrect password', async () => {
  await registerUser({ fullName: 'Dan', email: 'dan@example.com', password: 'Password123' });
  await expect(loginUser('dan@example.com', 'wrongpass')).rejects.toThrow('INVALID_CREDENTIALS');
});

test('inactive user login', async () => {
  const u = await registerUser({ fullName: 'Eve', email: 'eve@example.com', password: 'Password123' });
  // mark user inactive
  await User.updateOne({ email: 'eve@example.com' }, { $set: { status: 'inactive' } });
  await expect(loginUser('eve@example.com', 'Password123')).rejects.toThrow('USER_INACTIVE');
});

test('employee id login resolves correct panel access data', async () => {
  const passwordHash = await bcrypt.hash('Password123', 10);

  await User.create({
    employeeId: 'EMP-4201',
    fullName: 'Frank Employee',
    email: 'frank.employee@example.com',
    passwordHash,
    role: 'EMPLOYEE',
    employmentType: 'EMPLOYEE',
    departmentId: 'development',
    teamId: 'platform',
    status: 'ACTIVE',
    permissions: ['task.view', 'attendance.view'],
  });

  const result = await loginUser('EMP-4201', 'Password123');
  expect(result.user.employeeId).toBe('EMP-4201');
  expect(result.user.role).toBe('EMPLOYEE');
  expect(result.user.accessScope).toBeDefined();
  expect(result.user.permissions).toContain('task.view');
});
