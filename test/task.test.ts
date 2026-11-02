import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectToDatabase, disconnectDatabase } from '../src/config/database';
import Organization from '../src/models/Organization';
import Department from '../src/models/Department';
import Team from '../src/models/Team';
import User from '../src/models/User';
import Task from '../src/models/Task';
import TaskTimeSession from '../src/models/TaskTimeSession';
import DailyReport from '../src/models/DailyReport';
import Attendance from '../src/models/Attendance';
import WorkSession from '../src/models/WorkSession';
import { createTask, startTaskTimer, getTodayWorkSummary, createDailyReport } from '../src/services/taskService';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-task-test' },
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
  await Task.deleteMany({});
  await TaskTimeSession.deleteMany({});
  await WorkSession.deleteMany({});
  await DailyReport.deleteMany({});
  await User.deleteMany({});
  await Team.deleteMany({});
  await Department.deleteMany({});
  await Organization.deleteMany({});
});

test('task creation and timer workflow work together', async () => {
  const org = await Organization.create({ name: 'Org 1' });
  const dept = await Department.create({ organizationId: org._id, name: 'Engineering' });
  const team = await Team.create({ organizationId: org._id, departmentId: dept._id, name: 'Platform' });
  const owner = await User.create({ fullName: 'Alice', email: 'alice@example.com', passwordHash: 'hash', role: 'EMPLOYEE', employmentType: 'EMPLOYEE', organizationId: org._id, departmentId: dept._id, teamId: team._id });

  await Attendance.create({
    userId: owner._id,
    organizationId: org._id,
    date: new Date(),
    attendanceStatus: 'PRESENT',
    totalWorkDuration: 0,
    totalBreakDuration: 0,
    currentStatus: 'ONLINE',
  });

  const task = await createTask({
    title: 'Build dashboard',
    description: 'Create task dashboard',
    organizationId: org._id.toString(),
    departmentId: dept._id.toString(),
    teamId: team._id.toString(),
    assignedTo: owner._id.toString(),
    assignedBy: owner._id.toString(),
    priority: 'HIGH',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    estimatedMinutes: 120,
  });

  expect(task.taskId).toMatch(/TASK-/i);
  expect(task.status).toBe('ASSIGNED');

  const started = await startTaskTimer(task._id.toString(), owner._id.toString());
  expect(started.task.status).toBe('IN_PROGRESS');
  expect(started.session.status).toBe('ACTIVE');

  const summary = await getTodayWorkSummary(owner._id.toString());
  expect(summary.totalTrackedMinutes).toBeGreaterThanOrEqual(0);
  expect(summary.taskCount).toBeGreaterThanOrEqual(1);

  const report = await createDailyReport(owner._id.toString(), {
    summary: 'Completed dashboard milestone',
    highlights: ['Finished dashboard UI'],
    blockers: [],
    plannedTasks: ['Task follow-up'],
    completedTasks: ['Build dashboard'],
  });

  expect(report.status).toBe('DRAFT');
  expect(typeof report.completedTasks).toBe('number');
  expect(Array.isArray(report.blockers)).toBe(true);
  expect(report.totalWorkedMinutes).toBeGreaterThanOrEqual(0);
});

test('daily report handles string blockers, object blockers, and multiple updates', async () => {
  const org = await Organization.create({ name: 'Org 2' });
  const user = await User.create({ fullName: 'Bob', email: 'bob@example.com', passwordHash: 'hash', role: 'EMPLOYEE', employmentType: 'EMPLOYEE', organizationId: org._id });

  // 1. Create with string blockers and string completed tasks array
  const report1 = await createDailyReport(user._id.toString(), {
    summary: 'Initial draft',
    blockers: ['Database timeout', 'Missing API spec'],
    plannedTasks: ['Write tests', 'Refactor models'],
    completedTasks: ['Setup project'],
  });

  expect(report1.status).toBe('DRAFT');
  expect(report1.blockerCount).toBe(2);
  expect(report1.blockers).toHaveLength(2);
  expect(report1.blockers[0].title).toBe('Database timeout');
  expect(report1.blockers[0].severity).toBe('MEDIUM');
  expect(report1.blockers[0].blockerId).toMatch(/^BLK-/);
  expect(typeof report1.completedTasks).toBe('number');

  // 2. Repeated update with object blockers and empty blockers
  const report2 = await createDailyReport(user._id.toString(), {
    summary: 'Updated draft',
    blockers: [
      { title: 'Auth service latency', severity: 'HIGH', description: 'Affecting login latency' },
    ],
  });

  expect(report2.summary).toBe('Updated draft');
  expect(report2.blockerCount).toBe(1);
  expect(report2.blockers[0].title).toBe('Auth service latency');
  expect(report2.blockers[0].severity).toBe('HIGH');

  // 3. Update with empty blockers array
  const report3 = await createDailyReport(user._id.toString(), {
    summary: 'All blockers resolved',
    blockers: [],
  });

  expect(report3.blockerCount).toBe(0);
  expect(report3.blockers).toHaveLength(0);
});

test('task lifecycle from creation to submission and approval updates daily work summary', async () => {
  const org = await Organization.create({ name: 'Org 3' });
  const manager = await User.create({ fullName: 'Manager', email: 'mgr@example.com', passwordHash: 'hash', role: 'MANAGER', organizationId: org._id });
  const employee = await User.create({ fullName: 'Charlie', email: 'charlie@example.com', passwordHash: 'hash', role: 'EMPLOYEE', organizationId: org._id });

  await Attendance.create({
    userId: employee._id,
    organizationId: org._id,
    date: new Date(),
    attendanceStatus: 'PRESENT',
    currentStatus: 'ONLINE',
  });
  await WorkSession.create({
    userId: employee._id,
    attendanceId: (await Attendance.findOne({ userId: employee._id }) as any)._id,
    loginAt: new Date(),
    duration: 0,
    status: 'ACTIVE',
  });

  const task1 = await createTask({
    title: 'Feature A',
    assignedTo: employee._id.toString(),
    assignedBy: manager._id.toString(),
    organizationId: org._id.toString(),
  });

  const task2 = await createTask({
    title: 'Feature B',
    assignedTo: employee._id.toString(),
    assignedBy: manager._id.toString(),
    organizationId: org._id.toString(),
  });

  // Start & complete task 1
  await startTaskTimer(task1._id.toString(), employee._id.toString());
  const { submitTask, approveTask } = await import('../src/services/taskService');
  await submitTask(task1._id.toString(), employee._id.toString(), { completionNote: 'Done' });
  await approveTask(task1._id.toString(), manager);

  const summary = await getTodayWorkSummary(employee._id.toString());
  expect(summary.totalTasks).toBe(2);
  expect(summary.completedTasks).toBe(1);
  expect(summary.tasksCompleted).toBe(1);

  const report = await createDailyReport(employee._id.toString(), {
    summary: 'Finished Feature A today',
    completedSummary: 'Feature A deployed',
  });

  expect(report.tasksAssigned).toBe(2);
  expect(report.tasksCompleted).toBe(1);
  expect(typeof report.completedTasks).toBe('number');
  expect(report.completedTasks).toBe(1);
});
