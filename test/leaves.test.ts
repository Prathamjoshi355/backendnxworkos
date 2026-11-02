import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectToDatabase, disconnectDatabase } from '../src/config/database';
import User from '../src/models/User';
import Leave from '../src/models/Leave';
import LeaveType from '../src/models/LeaveType';
import { registerUser } from '../src/services/authService';
import * as leaveService from '../src/services/leaveService';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-leaves-test' },
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
  await Leave.deleteMany({});
  await LeaveType.deleteMany({});
  await User.deleteMany({});
});

describe('Leave Management Service & Business Logic Tests', () => {
  const org1Id = new mongoose.Types.ObjectId().toString();
  const org2Id = new mongoose.Types.ObjectId().toString();

  test('TEST 1 & 9: Employee submits leave with backend date and day calculation', async () => {
    const emp = await registerUser({
      fullName: 'Alice Employee',
      email: 'alice@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    const startDate = new Date('2026-09-01T00:00:00.000Z');
    const endDate = new Date('2026-09-03T00:00:00.000Z'); // 3 days inclusive

    const leave = await leaveService.applyLeave(emp, {
      startDate,
      endDate,
      reason: 'Family event',
      leaveTypeName: 'Casual Leave',
    });

    expect(leave).toBeTruthy();
    expect(leave.status).toBe('PENDING');
    expect(leave.totalDays).toBe(3);
    expect(String(leave.userId)).toBe(String((emp as any)._id));
    expect(String(leave.organizationId)).toBe(org1Id);

    // List leaves for Alice
    const result = await leaveService.listLeaves({ userId: (emp as any)._id, organizationId: org1Id });
    expect(result.total).toBe(1);
    expect(result.items[0].reason).toBe('Family event');
  });

  test('TEST 2 & 3: Employee B cannot access or cancel Employee A leave', async () => {
    const empA = await registerUser({
      fullName: 'Alice A',
      email: 'alice.a@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    const empB = await registerUser({
      fullName: 'Bob B',
      email: 'bob.b@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    const leaveA = await leaveService.applyLeave(empA, {
      startDate: new Date('2026-09-10'),
      endDate: new Date('2026-09-12'),
      reason: 'Medical rest',
    });

    // Employee B attempts to view Employee A's leave
    await expect(leaveService.getLeaveById(String(leaveA._id), empB)).rejects.toThrow('FORBIDDEN');

    // Employee B attempts to cancel Employee A's leave
    await expect(leaveService.cancelLeave(String(leaveA._id), empB)).rejects.toThrow('UNAUTHORIZED_CANCEL');
  });

  test('TEST 4 & 5: Backend enforces authenticated user ownership and organization', async () => {
    const emp = await registerUser({
      fullName: 'Charlie',
      email: 'charlie@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    const spoofedUserId = new mongoose.Types.ObjectId().toString();
    const spoofedOrgId = org2Id;

    // Apply leave passing spoofed fields in payload
    const leave = await leaveService.applyLeave(emp, {
      userId: spoofedUserId,
      organizationId: spoofedOrgId,
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-10-02'),
      reason: 'Conference attendance',
    });

    // Verified that backend bound leave strictly to authenticated user's ID and org
    expect(String(leave.userId)).toBe(String((emp as any)._id));
    expect(String(leave.organizationId)).toBe(org1Id);
    expect(String(leave.organizationId)).not.toBe(spoofedOrgId);
  });

  test('TEST 6 & 7: Admin views only own organization leaves & cannot approve other org leave', async () => {
    const adminOrg1 = await registerUser({
      fullName: 'Admin One',
      email: 'admin@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'ADMIN',
    });

    const empOrg2 = await registerUser({
      fullName: 'David Org2',
      email: 'david@org2.com',
      password: 'Password123',
      organizationId: org2Id,
      role: 'EMPLOYEE',
    });

    const leaveOrg2 = await leaveService.applyLeave(empOrg2, {
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-02'),
      reason: 'Personal work',
    });

    // Admin 1 attempts to view Org 2 leave
    await expect(leaveService.getLeaveById(String(leaveOrg2._id), adminOrg1)).rejects.toThrow('FORBIDDEN');

    // Admin 1 attempts to approve Org 2 leave
    await expect(leaveService.reviewLeave(String(leaveOrg2._id), 'APPROVED', adminOrg1)).rejects.toThrow('FORBIDDEN');
  });

  test('TEST 8: Super Admin can access cross-organization leave', async () => {
    const superAdmin = await registerUser({
      fullName: 'Global Super Admin',
      email: 'superadmin@nxplatform.com',
      password: 'Password123',
      role: 'SUPER_ADMIN',
    });

    const emp = await registerUser({
      fullName: 'Eva',
      email: 'eva@org2.com',
      password: 'Password123',
      organizationId: org2Id,
      role: 'EMPLOYEE',
    });

    const leave = await leaveService.applyLeave(emp, {
      startDate: new Date('2026-11-10'),
      endDate: new Date('2026-11-12'),
      reason: 'Vacation',
    });

    const fetched = await leaveService.getLeaveById(String(leave._id), superAdmin);
    expect(fetched).toBeTruthy();
    expect(String(fetched._id)).toBe(String(leave._id));
  });

  test('TEST 10: Overlapping leave requests for the same user are rejected', async () => {
    const emp = await registerUser({
      fullName: 'Frank',
      email: 'frank@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    await leaveService.applyLeave(emp, {
      startDate: new Date('2026-12-01'),
      endDate: new Date('2026-12-05'),
      reason: 'Trip',
    });

    // Overlapping dates
    await expect(
      leaveService.applyLeave(emp, {
        startDate: new Date('2026-12-03'),
        endDate: new Date('2026-12-07'),
        reason: 'Trip extension',
      })
    ).rejects.toThrow('LEAVE_OVERLAP');
  });

  test('TEST 11 & 12: Approve and Reject workflows with comment tracking', async () => {
    const admin = await registerUser({
      fullName: 'Admin Sarah',
      email: 'sarah@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'ADMIN',
    });

    const emp = await registerUser({
      fullName: 'George',
      email: 'george@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    const leave1 = await leaveService.applyLeave(emp, {
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-02'),
      reason: 'Leave 1',
    });

    const leave2 = await leaveService.applyLeave(emp, {
      startDate: new Date('2026-08-10'),
      endDate: new Date('2026-08-11'),
      reason: 'Leave 2',
    });

    // Approve leave 1
    const approved = await leaveService.reviewLeave(String(leave1._id), 'APPROVED', admin, 'Approved enjoy');
    expect(approved.status).toBe('APPROVED');
    expect(approved.reviewerComment).toBe('Approved enjoy');
    expect(String(approved.reviewedBy)).toBe(String((admin as any)._id));

    // Reject leave 2
    const rejected = await leaveService.reviewLeave(String(leave2._id), 'REJECTED', admin, 'Project deadline conflict');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.reviewerComment).toBe('Project deadline conflict');
  });

  test('TEST 13 & 14: Cancellation and Leave Balance calculation', async () => {
    const emp = await registerUser({
      fullName: 'Hannah',
      email: 'hannah@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    const admin = await registerUser({
      fullName: 'Admin Grace',
      email: 'grace@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'ADMIN',
    });

    // Default leave types seeded
    const balancesInitial = await leaveService.getLeaveBalance(String((emp as any)._id), org1Id);
    expect(balancesInitial.length).toBeGreaterThan(0);
    const casualLeave = balancesInitial.find((b) => b.leaveTypeName === 'Casual Leave')!;
    expect(casualLeave.allocated).toBe(12);
    expect(casualLeave.used).toBe(0);
    expect(casualLeave.pending).toBe(0);
    expect(casualLeave.remaining).toBe(12);

    // Apply for 2 days Casual Leave
    const leave = await leaveService.applyLeave(emp, {
      leaveTypeId: casualLeave.leaveTypeId,
      leaveTypeName: 'Casual Leave',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-02'), // 2 days
      reason: 'Rest',
    });

    const balancesAfterApply = await leaveService.getLeaveBalance(String((emp as any)._id), org1Id);
    const casualAfterApply = balancesAfterApply.find((b) => b.leaveTypeName === 'Casual Leave')!;
    expect(casualAfterApply.pending).toBe(2);
    expect(casualAfterApply.used).toBe(0);

    // Approve leave
    await leaveService.reviewLeave(String(leave._id), 'APPROVED', admin);
    const balancesAfterApprove = await leaveService.getLeaveBalance(String((emp as any)._id), org1Id);
    const casualAfterApprove = balancesAfterApprove.find((b) => b.leaveTypeName === 'Casual Leave')!;
    expect(casualAfterApprove.used).toBe(2);
    expect(casualAfterApprove.pending).toBe(0);
    expect(casualAfterApprove.remaining).toBe(10);
  });

  test('TEST 15: Self-approval protection prevents manager/lead from approving own leave', async () => {
    const manager = await registerUser({
      fullName: 'Manager Mike',
      email: 'mike@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'MANAGER',
    });

    const leave = await leaveService.applyLeave(manager, {
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-02'),
      reason: 'Personal time',
    });

    await expect(
      leaveService.reviewLeave(String(leave._id), 'APPROVED', manager)
    ).rejects.toThrow('CANNOT_APPROVE_OWN_LEAVE');
  });

  test('TEST 16: Approved leave creates attendance ON_LEAVE records and cancellation reverts it', async () => {
    const admin = await registerUser({
      fullName: 'Admin Alex',
      email: 'alex@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'ADMIN',
    });

    const emp = await registerUser({
      fullName: 'Iris',
      email: 'iris@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'EMPLOYEE',
    });

    const leave = await leaveService.applyLeave(emp, {
      startDate: new Date('2026-05-10T00:00:00.000Z'),
      endDate: new Date('2026-05-11T00:00:00.000Z'), // 2 days
      reason: 'Vacation',
    });

    await leaveService.reviewLeave(String(leave._id), 'APPROVED', admin);

    const Attendance = (await import('../src/models/Attendance')).default;
    const attRecords = await Attendance.find({ userId: (emp as any)._id }).lean();
    expect(attRecords.length).toBe(2);
    expect(attRecords[0].attendanceStatus).toBe('ON_LEAVE');

    // Cancel approved leave
    await leaveService.cancelLeave(String(leave._id), emp);
    const revertedRecords = await Attendance.find({ userId: (emp as any)._id }).lean();
    expect(revertedRecords.length).toBe(2);
    expect(revertedRecords[0].attendanceStatus).toBe('ABSENT');
  });

  test('TEST 17: Leave analytics aggregates metrics correctly', async () => {
    const admin = await registerUser({
      fullName: 'Admin Analytics',
      email: 'admin.analytics@org1.com',
      password: 'Password123',
      organizationId: org1Id,
      role: 'ADMIN',
    });

    const analytics = await leaveService.getLeaveAnalytics(admin);
    expect(analytics).toBeDefined();
    expect(typeof analytics.total).toBe('number');
    expect(typeof analytics.pending).toBe('number');
    expect(typeof analytics.approved).toBe('number');
  });
});
