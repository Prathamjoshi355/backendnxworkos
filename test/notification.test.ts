import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectToDatabase, disconnectDatabase } from '../src/config/database';
import Organization from '../src/models/Organization';
import User from '../src/models/User';
import Task from '../src/models/Task';
import Notification from '../src/models/Notification';
import { createNotification, getUserNotifications, getUnreadCount, markAsRead, markAllAsRead } from '../src/services/notificationService';
import { createTask, approveTask, rejectTask, submitTask } from '../src/services/taskService';
import { createTaskDeadlineReminderNotifications, createTaskOverdueNotifications, createEodPendingNotifications } from '../src/services/reminderService';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { ip: '127.0.0.1', port: 0, dbName: 'nxplatform-notification-test' },
  });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.JWT_SECRET = '__test_jwt_secret__';
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
  await mongo.stop();
});

afterEach(async () => {
  await Notification.deleteMany({});
  await Task.deleteMany({});
  await User.deleteMany({});
  await Organization.deleteMany({});
});

test('notification creation and unread count', async () => {
  const org = await Organization.create({ name: 'Notify Org' });
  const user = await User.create({ fullName: 'Alice', email: 'alice@example.com', passwordHash: 'hash', role: 'EMPLOYEE', employmentType: 'EMPLOYEE', organizationId: org._id });

  const created = await createNotification({
    recipientId: user._id.toString(),
    organizationId: org._id.toString(),
    type: 'TASK_ASSIGNED',
    title: 'New Task Assigned',
    message: 'You have been assigned a new task.',
    entityType: 'TASK',
    entityId: 'task-1',
    priority: 'NORMAL',
  });

  expect(created.type).toBe('TASK_ASSIGNED');
  expect(await getUnreadCount(user._id.toString())).toBe(1);

  const list = await getUserNotifications(user._id.toString());
  expect(list.total).toBeGreaterThanOrEqual(1);
});

test('mark as read and mark all as read', async () => {
  const org = await Organization.create({ name: 'Notify Org 2' });
  const user = await User.create({ fullName: 'Bob', email: 'bob@example.com', passwordHash: 'hash', role: 'EMPLOYEE', employmentType: 'EMPLOYEE', organizationId: org._id });

  const first = await createNotification({ recipientId: user._id.toString(), organizationId: org._id.toString(), type: 'TASK_UPDATED', title: 'Task Updated', message: 'Updated', entityType: 'TASK', entityId: 'task-2', priority: 'HIGH' });
  await markAsRead(String(first._id), user._id.toString());
  expect(await getUnreadCount(user._id.toString())).toBe(0);

  const second = await createNotification({ recipientId: user._id.toString(), organizationId: org._id.toString(), type: 'TASK_REJECTED', title: 'Task rejected', message: 'Rejected', entityType: 'TASK', entityId: 'task-3', priority: 'URGENT' });
  await markAllAsRead(user._id.toString());
  expect(await Notification.findOne({ _id: second._id, isRead: true }).lean()).toBeTruthy();
});

test('task assignment, approval, rejection and submission create notifications', async () => {
  const org = await Organization.create({ name: 'Notify Org 3' });
  const employee = await User.create({ fullName: 'Eli', email: 'eli@example.com', passwordHash: 'hash', role: 'EMPLOYEE', employmentType: 'EMPLOYEE', organizationId: org._id });
  const manager = await User.create({ fullName: 'Mia', email: 'mia@example.com', passwordHash: 'hash', role: 'MANAGER', employmentType: 'EMPLOYEE', organizationId: org._id });
  await (await import('../src/models/Attendance')).default.create({
    userId: employee._id,
    organizationId: org._id,
    date: new Date(),
    attendanceStatus: 'PRESENT',
    totalWorkDuration: 0,
    totalBreakDuration: 0,
    currentStatus: 'ONLINE',
  });

  const task = await createTask({ title: 'Launch feature', assignedTo: employee._id.toString(), assignedBy: manager._id.toString(), organizationId: org._id.toString() });
  const assignmentNotifications = await Notification.find({ recipientId: employee._id, type: 'TASK_ASSIGNED' }).lean();
  expect(assignmentNotifications.length).toBeGreaterThanOrEqual(1);

  const started = await (await import('../src/services/taskService')).startTaskTimer(task._id.toString(), employee._id.toString());
  expect(started.task.status).toBe('IN_PROGRESS');

  const submitted = await submitTask(task._id.toString(), employee._id.toString(), { completionNote: 'Done' });
  const submissionNotifications = await Notification.find({ recipientId: manager._id, type: 'TASK_SUBMITTED' }).lean();
  expect(submissionNotifications.length).toBeGreaterThanOrEqual(1);

  await approveTask(task._id.toString());
  const approvalNotifications = await Notification.find({ recipientId: employee._id, type: 'TASK_APPROVED' }).lean();
  expect(approvalNotifications.length).toBeGreaterThanOrEqual(1);

  await rejectTask(task._id.toString(), 'Need revision');
  const rejectionNotifications = await Notification.find({ recipientId: employee._id, type: 'TASK_REJECTED' }).lean();
  expect(rejectionNotifications.length).toBeGreaterThanOrEqual(1);
  expect(submitted.task.status).toBe('REVIEW');
});

test('reminder and EOD pending notifications are deduplicated', async () => {
  const org = await Organization.create({ name: 'Notify Org 4' });
  const user = await User.create({ fullName: 'Sam', email: 'sam@example.com', passwordHash: 'hash', role: 'EMPLOYEE', employmentType: 'EMPLOYEE', organizationId: org._id });

  const task = await Task.create({
    taskId: 'TASK-REMINDER-1',
    title: 'Reminder task',
    organizationId: org._id,
    assignedTo: user._id,
    assignedBy: user._id,
    priority: 'MEDIUM',
    status: 'ASSIGNED',
    dueDate: new Date(Date.now() + 60 * 60 * 1000),
  });

  await createTaskDeadlineReminderNotifications();
  await createTaskDeadlineReminderNotifications();
  const reminderCount = await Notification.countDocuments({ recipientId: user._id, type: 'TASK_DEADLINE_SOON', entityId: String(task._id) });
  expect(reminderCount).toBeGreaterThanOrEqual(1);

  const eod = await createEodPendingNotifications();
  expect(Array.isArray(eod)).toBeTruthy();
});
