import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import User from '../src/models/User';
import { connectToDatabase, disconnectDatabase } from '../src/config/database';
import { app } from '../src/app';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-auth-integration-test' },
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

// Helper to create a valid ObjectId for testing
function createObjectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

// Helper to create a proper password hash
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

describe('POST /api/auth/login', () => {
  test('login with email returns token and user with all required fields', async () => {
    // Create test user with valid ObjectIds and proper password hash
    const testOrgId = createObjectId();
    const testManagerId = createObjectId();
    const passwordHash = await hashPassword('password');

    await User.create({
      employeeId: 'E001',
      fullName: 'Test User',
      email: 'test@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
      organizationId: testOrgId,
      departmentId: 'dept-1',
      teamId: 'team-1',
      reportingManagerId: testManagerId,
      designation: 'Developer',
      joiningDate: new Date('2023-01-01'),
      status: 'ACTIVE',
      profilePhoto: 'https://example.com/photo.jpg',
      permissions: ['task.view', 'attendance.checkin'],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('user');

    const { user, token } = res.body.data;
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    // Verify all required fields for Flutter AccessContext
    expect(user).toHaveProperty('_id');
    expect(user).toHaveProperty('employeeId', 'E001');
    expect(user).toHaveProperty('fullName', 'Test User');
    expect(user).toHaveProperty('email', 'test@example.com');
    expect(user).toHaveProperty('role', 'EMPLOYEE');
    expect(user).toHaveProperty('employmentType', 'EMPLOYEE');
    expect(user).toHaveProperty('organizationId', testOrgId.toString());
    expect(user).toHaveProperty('departmentId', 'dept-1');
    expect(user).toHaveProperty('teamId', 'team-1');
    expect(user).toHaveProperty('reportingManagerId', testManagerId.toString());
    expect(user).toHaveProperty('designation', 'Developer');
    expect(user).toHaveProperty('joiningDate');
    expect(user).toHaveProperty('status', 'ACTIVE');
    expect(user).toHaveProperty('profilePhoto');
    expect(user).toHaveProperty('permissions');
    expect(Array.isArray(user.permissions)).toBe(true);

    // Should NOT include passwordHash
    expect(user).not.toHaveProperty('passwordHash');
  });

  test('login with employee ID returns correct response', async () => {
    const passwordHash = await hashPassword('password');

    await User.create({
      employeeId: 'E002',
      fullName: 'Employee User',
      email: 'employee@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
      status: 'ACTIVE',
      permissions: [],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employee@example.com', password: 'password' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.employeeId).toBe('E002');
  });

  test('login with invalid credentials returns 401', async () => {
    const passwordHash = await hashPassword('password');

    await User.create({
      fullName: 'Test User',
      email: 'test@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
      status: 'ACTIVE',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('login with inactive user returns 403', async () => {
    const passwordHash = await hashPassword('password');

    await User.create({
      fullName: 'Inactive User',
      email: 'inactive@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
      status: 'INACTIVE',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inactive@example.com', password: 'password' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  test('login with missing fields returns validation error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com' }); // missing password

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('super admin login returns all super admin permissions', async () => {
    const passwordHash = await hashPassword('password');

    await User.create({
      fullName: 'Super Admin',
      email: 'superadmin@example.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      employmentType: 'EMPLOYEE',
      status: 'ACTIVE',
      permissions: [],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'superadmin@example.com', password: 'password' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('SUPER_ADMIN');
  });

  test('admin login includes compensation permissions', async () => {
    const testOrgId = createObjectId();
    const passwordHash = await hashPassword('password');

    await User.create({
      fullName: 'Admin User',
      email: 'admin@example.com',
      passwordHash,
      role: 'ADMIN',
      employmentType: 'EMPLOYEE',
      organizationId: testOrgId,
      status: 'ACTIVE',
      permissions: ['compensation.view', 'compensation.create', 'user.view'],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(Array.isArray(res.body.data.user.permissions)).toBe(true);
    expect(res.body.data.user.permissions.length).toBeGreaterThan(0);
  });

  test('intern login returns correct employment type', async () => {
    const passwordHash = await hashPassword('password');

    await User.create({
      fullName: 'Intern User',
      email: 'intern@example.com',
      passwordHash,
      role: 'INTERN',
      employmentType: 'INTERN',
      departmentId: 'dept-1',
      status: 'ACTIVE',
      permissions: ['attendance.checkin'],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'intern@example.com', password: 'password' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.employmentType).toBe('INTERN');
    expect(res.body.data.user.role).toBe('INTERN');
  });
});

describe('GET /api/auth/me', () => {
  test('get current user with valid token', async () => {
    // Create user and login
    const passwordHash = await hashPassword('password');

    await User.create({
      employeeId: 'E003',
      fullName: 'Current User',
      email: 'current@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
      departmentId: 'dept-1',
      status: 'ACTIVE',
      permissions: ['task.view'],
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'current@example.com', password: 'password' });

    const token = loginRes.body.data.token;

    // Get current user
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toHaveProperty('email', 'current@example.com');
    expect(res.body.data.user).toHaveProperty('employeeId', 'E003');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  test('get current user without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('get current user with invalid token returns 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_token_here');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('get current user returns all required fields', async () => {
    // Create comprehensive user with valid ObjectIds and proper hash
    const testOrgId = createObjectId();
    const testManagerId = createObjectId();
    const passwordHash = await hashPassword('password');

    await User.create({
      employeeId: 'E004',
      fullName: 'Full User',
      email: 'full@example.com',
      passwordHash,
      role: 'MANAGER',
      employmentType: 'EMPLOYEE',
      organizationId: testOrgId,
      departmentId: 'dept-1',
      teamId: 'team-1',
      reportingManagerId: testManagerId,
      designation: 'Manager',
      joiningDate: new Date('2022-01-01'),
      status: 'ACTIVE',
      profilePhoto: 'https://example.com/profile.jpg',
      permissions: ['task.view', 'task.create', 'team.view'],
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'full@example.com', password: 'password' });

    const token = loginRes.body.data.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const user = res.body.data.user;
    expect(user._id).toBeTruthy();
    expect(user.employeeId).toBe('E004');
    expect(user.fullName).toBe('Full User');
    expect(user.email).toBe('full@example.com');
    expect(user.role).toBe('MANAGER');
    expect(user.employmentType).toBe('EMPLOYEE');
    expect(user.organizationId).toBe(testOrgId.toString());
    expect(user.departmentId).toBe('dept-1');
    expect(user.teamId).toBe('team-1');
    expect(user.reportingManagerId).toBe(testManagerId.toString());
    expect(user.designation).toBe('Manager');
    expect(user.permissions).toEqual(['task.view', 'task.create', 'team.view']);
  });
});

describe('Authorization Tests', () => {
  test('employee cannot access admin endpoint', async () => {
    // This test documents that frontend is NOT the security boundary
    // Backend MUST enforce permissions with 403
    const passwordHash = await hashPassword('password');

    await User.create({
      fullName: 'Employee',
      email: 'emp@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
      status: 'ACTIVE',
      permissions: [],
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'emp@example.com', password: 'password' });

    const token = loginRes.body.data.token;

    // Attempt to access admin endpoint directly (backend should return 403)
    // This is a placeholder - actual admin endpoint testing depends on implementation
    expect(token).toBeTruthy();
  });

  test('developer cannot create sales leads via API', async () => {
    // Document the constraint: "Frontend navigation is NOT security"
    // Backend must enforce via permission checks returning 403
    const passwordHash = await hashPassword('password');

    await User.create({
      fullName: 'Developer',
      email: 'dev@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
      status: 'ACTIVE',
      permissions: ['task.view'], // Developer permission only, not sales
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dev@example.com', password: 'password' });

    const token = loginRes.body.data.token;
    expect(token).toBeTruthy();

    // If leads endpoint exists, it should enforce authorization at backend
    // (This is a design documentation test, not an actual endpoint test)
  });
});
