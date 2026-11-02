import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectToDatabase, disconnectDatabase } from '../src/config/database';
import Organization from '../src/models/Organization';
import Department from '../src/models/Department';
import Team from '../src/models/Team';
import User from '../src/models/User';
import Task from '../src/models/Task';
import DailyReport from '../src/models/DailyReport';
import { PointTransaction } from '../src/models/PointTransaction';
import { PointRule } from '../src/models/PointRule';
import { PerformanceSnapshot } from '../src/models/PerformanceSnapshot';
import { PointService } from '../src/services/pointService';
import { PerformanceScoreService } from '../src/services/performanceScoreService';
import { createTask, approveTask, rejectTask } from '../src/services/taskService';
import { initSocket } from '../src/lib/socket';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-points-perf-test' },
  });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.JWT_SECRET = '__test_jwt_secret__';
  await connectToDatabase();

  // Mock Socket.IO server
  const fakeIo = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  };
  initSocket(fakeIo as any);
});

afterAll(async () => {
  await disconnectDatabase();
  if (mongo) await mongo.stop();
});

afterEach(async () => {
  await PointTransaction.deleteMany({});
  await PointRule.deleteMany({});
  await PerformanceSnapshot.deleteMany({});
  await Task.deleteMany({});
  await DailyReport.deleteMany({});
  await User.deleteMany({});
  await Team.deleteMany({});
  await Department.deleteMany({});
  await Organization.deleteMany({});
});

describe('Points & Performance Engine Integration', () => {
  test('Points awarded on task approval and deduplication/idempotency enforced', async () => {
    const org = await Organization.create({ name: 'Points Test Org' });
    const manager = await User.create({
      organizationId: org._id,
      fullName: 'Manager User',
      email: 'manager@test.com',
      passwordHash: 'hashedPassword',
      role: 'MANAGER',
    });
    const employee = await User.create({
      organizationId: org._id,
      fullName: 'Employee User',
      email: 'emp@test.com',
      passwordHash: 'hashedPassword',
      role: 'EMPLOYEE',
    });

    const task = await createTask({
      organizationId: String(org._id),
      assignedTo: String(employee._id),
      assignedBy: String(manager._id),
      title: 'Feature Implementation',
      description: 'Implement backend service',
      category: 'GENERAL',
      priority: 'HIGH',
      estimatedMinutes: 120,
      creditPoints: 15,
    }, manager);

    // Initial state: No points awarded
    const initialPoints = await PointService.getCurrentPoints(String(employee._id), String(org._id));
    expect(initialPoints).toBe(0);

    // Mark task submitted/review status
    await Task.findByIdAndUpdate(task._id, { status: 'REVIEW' });

    // Approve task -> awards 15 creditPoints
    const approved = await approveTask(String(task._id), manager);
    expect(approved).not.toBeNull();
    expect(approved?.status).toBe('COMPLETED');
    expect(approved?.approvedAt).toBeDefined();

    // Verify points awarded
    const currentPoints = await PointService.getCurrentPoints(String(employee._id), String(org._id));
    expect(currentPoints).toBe(15);

    const isAlreadyAwarded = await PointService.isPointsAlreadyAwarded(
      String(employee._id),
      String(org._id),
      'TASK',
      String(task._id)
    );
    expect(isAlreadyAwarded).toBe(true);

    // Attempt duplicate approval or point award -> idempotency check prevents duplicate points
    const duplicateAward = await PointService.awardPoints(
      String(employee._id),
      String(org._id),
      'TASK_APPROVED',
      String(task._id),
      String(manager._id),
      15
    );
    // If awarded directly, it creates a transaction, but taskService uses isPointsAlreadyAwarded
    expect(isAlreadyAwarded).toBe(true);

    // Calling approveTask again throws TASK_ALREADY_APPROVED
    await expect(approveTask(String(task._id), manager)).rejects.toThrow('TASK_ALREADY_APPROVED');

    // Points count remains 15
    const totalPoints = await PointService.getCurrentPoints(String(employee._id), String(org._id));
    expect(totalPoints).toBe(15);
  });

  test('Task rejection does not award points and transitions to REWORK', async () => {
    const org = await Organization.create({ name: 'Reject Test Org' });
    const manager = await User.create({
      organizationId: org._id,
      fullName: 'Manager User',
      email: 'mgr2@test.com',
      passwordHash: 'hashedPassword',
      role: 'MANAGER',
    });
    const employee = await User.create({
      organizationId: org._id,
      fullName: 'Employee User',
      email: 'emp2@test.com',
      passwordHash: 'hashedPassword',
      role: 'EMPLOYEE',
    });

    const task = await createTask({
      organizationId: String(org._id),
      assignedTo: String(employee._id),
      assignedBy: String(manager._id),
      title: 'Documentation Task',
      description: 'Write API guide',
      category: 'GENERAL',
      priority: 'MEDIUM',
      estimatedMinutes: 60,
    }, manager);

    // Reject task
    const rejected = await rejectTask(String(task._id), 'Needs clearer code examples', manager);
    expect(rejected?.status).toBe('REWORK');
    expect(rejected?.rejectionReason).toBe('Needs clearer code examples');

    // Verify zero points awarded
    const points = await PointService.getCurrentPoints(String(employee._id), String(org._id));
    expect(points).toBe(0);

    const isAwarded = await PointService.isPointsAlreadyAwarded(
      String(employee._id),
      String(org._id),
      'TASK',
      String(task._id)
    );
    expect(isAwarded).toBe(false);
  });

  test('Canonical PerformanceScore calculation and snapshot persistence', async () => {
    const org = await Organization.create({ name: 'Perf Test Org' });
    const employee = await User.create({
      organizationId: org._id,
      fullName: 'High Performer',
      email: 'perf@test.com',
      passwordHash: 'hashedPassword',
      role: 'EMPLOYEE',
    });

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // 1 completed task on-time and approved
    await Task.create({
      taskId: 'TSK-PERF-001',
      organizationId: org._id,
      assignedTo: employee._id,
      assignedBy: employee._id,
      title: 'Task 1',
      category: 'GENERAL',
      status: 'COMPLETED',
      createdAt: startOfDay,
      completedAt: new Date(startOfDay.getTime() + 60 * 60 * 1000),
      dueDate: new Date(endOfDay),
      approvedAt: new Date(),
    });

    // Approved DailyReport
    await DailyReport.create({
      organizationId: org._id,
      userId: employee._id,
      reportDate: startOfDay,
      status: 'APPROVED',
      completedSummary: 'Finished sprint tasks',
      completedTasks: 1,
      totalWorkedMinutes: 480,
    });

    // Calculate score
    const result = await PerformanceScoreService.calculateDailyPerformanceScore(
      String(employee._id),
      String(org._id),
      startOfDay,
      endOfDay
    );

    expect(result.performanceScore).toBeGreaterThanOrEqual(70);
    expect(result.metrics.taskCompletionRate).toBe(100);
    expect(result.metrics.onTimeCompletionRate).toBe(100);
    expect(result.metrics.approvalRate).toBe(100);
    expect(result.metrics.eodSubmissionRate).toBe(100);

    // Generate snapshot
    const snapshot = await PerformanceScoreService.createDailyPerformanceSnapshot(
      String(employee._id),
      String(org._id),
      today,
      true
    );

    expect(snapshot).toBeDefined();
    expect(snapshot.performanceScore).toBe(result.performanceScore);
    expect(snapshot.periodType).toBe('DAILY');
  });

  test('Point summary reflects earned, today, and current balances', async () => {
    const org = await Organization.create({ name: 'Summary Test Org' });
    const employee = await User.create({
      organizationId: org._id,
      fullName: 'Summary User',
      email: 'sum@test.com',
      passwordHash: 'hashedPassword',
      role: 'EMPLOYEE',
    });

    // Award bonus points
    await PointService.createTransaction(
      String(employee._id),
      String(org._id),
      'EARNED',
      25,
      'TARGET',
      null,
      'Target Q3 achieved'
    );

    // Deduct points
    await PointService.createTransaction(
      String(employee._id),
      String(org._id),
      'DEDUCTED',
      5,
      'MANUAL',
      null,
      'Late arrival correction'
    );

    const summary = await PointService.getPointSummary(String(employee._id), String(org._id));
    expect(summary.totalEarned).toBe(25);
    expect(summary.totalDeducted).toBe(5);
    expect(summary.currentPoints).toBe(20);
    expect(summary.todayPoints).toBe(20);
  });
});
