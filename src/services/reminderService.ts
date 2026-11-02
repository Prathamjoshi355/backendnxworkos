import Task from "../models/Task";
import User from "../models/User";
import DailyReport from "../models/DailyReport";
import { createBulkNotifications } from "./notificationService";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function isTaskActive(task: any) {
  return !["COMPLETED", "CANCELLED"].includes(task.status);
}

export async function createTaskDeadlineReminderNotifications() {
  const now = new Date();
  const tasks = await Task.find({
    status: { $nin: ["COMPLETED", "CANCELLED"] },
    dueDate: { $ne: null },
  }).lean();

  const items: any[] = [];
  for (const task of tasks) {
    const dueAt = task.dueDate ? new Date(task.dueDate) : null;
    if (!dueAt) continue;
    const msLeft = dueAt.getTime() - now.getTime();
    if (msLeft <= 0) continue;

    if (msLeft <= DAY_IN_MS) {
      items.push({
        recipientId: String(task.assignedTo),
        organizationId: String(task.organizationId || ""),
        type: "TASK_DEADLINE_SOON",
        title: "Task deadline approaching",
        message: `Task "${task.title}" is due within 24 hours.`,
        entityType: "TASK",
        entityId: String(task._id),
        priority: task.priority === "URGENT" || task.priority === "HIGH" ? "HIGH" : "NORMAL",
        dedupeKey: `TASK_DEADLINE_SOON:${String(task._id)}:24h`,
      });
    }

    if (msLeft <= TWO_HOURS_MS) {
      items.push({
        recipientId: String(task.assignedTo),
        organizationId: String(task.organizationId || ""),
        type: "TASK_DEADLINE_SOON",
        title: "Task deadline soon",
        message: `Task "${task.title}" is due in less than 2 hours.`,
        entityType: "TASK",
        entityId: String(task._id),
        priority: "URGENT",
        dedupeKey: `TASK_DEADLINE_SOON:${String(task._id)}:2h`,
      });
    }
  }

  if (!items.length) return [];
  return createBulkNotifications(items);
}

export async function createTaskOverdueNotifications() {
  const now = new Date();
  const tasks = await Task.find({
    status: { $nin: ["COMPLETED", "CANCELLED"] },
    dueDate: { $lt: now },
  }).lean();

  const items: any[] = [];
  for (const task of tasks) {
    if (!isTaskActive(task)) continue;
    items.push({
      recipientId: String(task.assignedTo),
      organizationId: String(task.organizationId || ""),
      type: "TASK_OVERDUE",
      title: "Task overdue",
      message: `Task "${task.title}" is overdue.`,
      entityType: "TASK",
      entityId: String(task._id),
      priority: "URGENT",
      dedupeKey: `TASK_OVERDUE:${String(task._id)}`,
    });
  }

  if (!items.length) return [];
  return createBulkNotifications(items);
}

export async function createEodPendingNotifications() {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  const users = await User.find({ status: "ACTIVE" }).lean();
  const items: any[] = [];

  for (const user of users) {
    if (!user.organizationId) continue;
    const report = await DailyReport.findOne({ userId: user._id, reportDate: { $gte: todayStart, $lte: todayEnd } }).lean();
    if (report && report.status === "SUBMITTED") continue;
    items.push({
      recipientId: String(user._id),
      organizationId: String(user.organizationId),
      type: "EOD_REPORT_PENDING",
      title: "End-of-day report pending",
      message: "Please submit your end-of-day report before logging out.",
      entityType: "DAILY_REPORT",
      entityId: String(user._id),
      priority: "HIGH",
      dedupeKey: `EOD_REPORT_PENDING:${String(user._id)}:${today.toISOString().slice(0, 10)}`,
    });
  }

  if (!items.length) return [];
  return createBulkNotifications(items);
}
