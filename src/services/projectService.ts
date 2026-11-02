import Project from "../models/Project";
import Task from "../models/Task";
import { createNotification } from "./notificationService";
import { recordAuditLog } from "./auditLogService";
import {
  emitProjectCreated,
  emitProjectUpdated,
  emitProjectMemberAdded,
  emitProjectMemberRemoved,
  emitProjectArchived,
} from "../lib/socketEmitters";

function generateProjectCode(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const prefix = clean.substring(0, 4) || "PRJ";
  const random = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${random}`;
}

export async function createProject(user: any, payload: any) {
  const orgId = user.organizationId || payload.organizationId;
  if (!orgId) throw new Error("ORGANIZATION_ID_REQUIRED");

  const count = await Project.countDocuments({ organizationId: orgId });
  const projCode = payload.code ? payload.code.toUpperCase() : generateProjectCode(payload.name);
  const projectId = `PRJ-${String(count + 1).padStart(4, "0")}`;

  const members = Array.isArray(payload.members) ? [...payload.members] : [];
  const ownerId = payload.ownerId || user._id || user.id;

  if (ownerId && !members.some((m) => String(m) === String(ownerId))) {
    members.push(ownerId);
  }
  if (user._id && !members.some((m) => String(m) === String(user._id))) {
    members.push(user._id);
  }

  const project = await Project.create({
    projectId,
    organizationId: orgId,
    departmentId: payload.departmentId || user.departmentId || null,
    teamId: payload.teamId || user.teamId || null,
    name: payload.name,
    code: projCode,
    description: payload.description || null,
    ownerId,
    status: payload.status || "PLANNED",
    priority: payload.priority || "MEDIUM",
    startDate: payload.startDate ? new Date(payload.startDate) : null,
    dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
    progress: 0,
    members,
    createdBy: user._id || user.id,
  });

  const projectObj = project.toObject();

  // Socket.IO event emission
  emitProjectCreated(projectObj, String(orgId));

  // Notify members
  for (const memberId of members) {
    if (String(memberId) !== String(user._id)) {
      await createNotification({
        recipientId: String(memberId),
        organizationId: String(orgId),
        title: "Added to New Project",
        message: `You were added to project "${project.name}" (${projCode}).`,
        type: "PROJECT",
        entityId: String(project._id),
      }).catch(() => {});
    }
  }

  await recordAuditLog({
    organizationId: String(orgId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "PROJECT_CREATED",
    entityType: "PROJECT",
    entityId: String(project._id),
    summary: `Created project ${project.name}`,
  });

  return projectObj;
}

export async function listProjects(user: any, filter: Record<string, unknown> = {}, opts: { skip?: number; limit?: number } = {}) {
  const skip = opts.skip || 0;
  const limit = opts.limit || 50;

  const queryFilter: Record<string, unknown> = { ...filter };

  // Enforce organization scoping
  if (user.role !== "SUPER_ADMIN") {
    queryFilter.organizationId = user.organizationId;
  }

  // Enforce role-based membership visibility for employees
  if (["EMPLOYEE", "INTERN", "DESIGNER", "SALES_EXECUTIVE"].includes(user.role)) {
    queryFilter.$or = [
      { members: user._id },
      { ownerId: user._id },
    ];
  }

  const items = await Project.find(queryFilter)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("ownerId", "fullName email employeeId role")
    .populate("members", "fullName email employeeId role")
    .populate("departmentId", "name code")
    .populate("teamId", "name code")
    .lean();

  // Dynamically calculate authoritative task metrics and progress for each project
  for (const item of items) {
    const totalTasks = await Task.countDocuments({ projectId: item._id });
    const completedTasks = await Task.countDocuments({ projectId: item._id, status: "COMPLETED" });
    const calculatedProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : item.progress || 0;
    (item as any).progress = calculatedProgress;
    (item as any).totalTasks = totalTasks;
    (item as any).completedTasks = completedTasks;
  }

  const total = await Project.countDocuments(queryFilter);
  return { items, total };
}

export async function getProjectById(projectId: string, user: any) {
  const project = await Project.findById(projectId)
    .populate("ownerId", "fullName email employeeId role")
    .populate("members", "fullName email employeeId role")
    .populate("departmentId", "name code")
    .populate("teamId", "name code")
    .lean();

  if (!project) throw new Error("PROJECT_NOT_FOUND");

  // Enforce organization isolation
  if (user.role !== "SUPER_ADMIN" && String(project.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // Enforce employee membership visibility
  if (["EMPLOYEE", "INTERN", "DESIGNER", "SALES_EXECUTIVE"].includes(user.role)) {
    const isMember = (project.members || []).some((m: any) => String(m._id || m) === String(user._id));
    const isOwner = String((project.ownerId as any)?._id || project.ownerId) === String(user._id);
    if (!isMember && !isOwner) {
      throw new Error("FORBIDDEN");
    }
  }

  // Dynamically calculate authoritative task progress
  const totalTasks = await Task.countDocuments({ projectId: project._id });
  const completedTasks = await Task.countDocuments({ projectId: project._id, status: "COMPLETED" });
  const calculatedProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : project.progress || 0;

  (project as any).progress = calculatedProgress;
  (project as any).totalTasks = totalTasks;
  (project as any).completedTasks = completedTasks;

  return project;
}

export async function updateProject(projectId: string, user: any, payload: any) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  // Enforce organization isolation
  if (user.role !== "SUPER_ADMIN" && String(project.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  // Enforce authorization: SUPER_ADMIN, ADMIN, project owner, or manager
  const isSuper = user.role === "SUPER_ADMIN";
  const isAdmin = user.role === "ADMIN";
  const isOwner = String(project.ownerId) === String(user._id || user.id);
  const isManager = user.role === "MANAGER" || user.role === "TEAM_LEADER";

  if (!isSuper && !isAdmin && !isOwner && !isManager) {
    throw new Error("FORBIDDEN");
  }

  const oldStatus = project.status;
  if (payload.name) project.name = payload.name;
  if (payload.code) project.code = payload.code.toUpperCase();
  if (payload.description !== undefined) project.description = payload.description;
  if (payload.status) project.status = payload.status;
  if (payload.priority) project.priority = payload.priority;
  if (payload.ownerId) project.ownerId = payload.ownerId;
  if (payload.departmentId !== undefined) project.departmentId = payload.departmentId;
  if (payload.teamId !== undefined) project.teamId = payload.teamId;
  if (payload.startDate) project.startDate = new Date(payload.startDate);
  if (payload.dueDate) project.dueDate = new Date(payload.dueDate);
  if (Array.isArray(payload.members)) project.members = payload.members;

  await project.save();

  const totalTasks = await Task.countDocuments({ projectId: project._id });
  const completedTasks = await Task.countDocuments({ projectId: project._id, status: "COMPLETED" });
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : project.progress || 0;

  const projectObj = {
    ...project.toObject(),
    totalTasks,
    completedTasks,
    progress,
  };

  // Emit real-time update
  emitProjectUpdated(projectObj, String(project.organizationId));

  if (payload.status && payload.status !== oldStatus) {
    for (const memberId of project.members) {
      await createNotification({
        recipientId: String(memberId),
        organizationId: String(project.organizationId),
        title: "Project Status Changed",
        message: `Project "${project.name}" status changed to ${project.status}.`,
        type: "PROJECT",
        entityId: String(project._id),
      }).catch(() => {});
    }
  }

  await recordAuditLog({
    organizationId: String(project.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "PROJECT_UPDATED",
    entityType: "PROJECT",
    entityId: String(project._id),
    summary: `Updated project ${project.name}`,
  });

  return projectObj;
}

export async function archiveProject(projectId: string, user: any) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(project.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  project.status = "CANCELLED";
  await project.save();

  emitProjectArchived(project.toObject(), String(project.organizationId));

  await recordAuditLog({
    organizationId: String(project.organizationId),
    actorId: String(user._id || user.id),
    actorRole: user.role,
    action: "PROJECT_ARCHIVED",
    entityType: "PROJECT",
    entityId: String(project._id),
    summary: `Archived/cancelled project ${project.name}`,
  });

  return project.toObject();
}

export async function addProjectMembers(projectId: string, memberIds: string[], user: any) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(project.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  const existingSet = new Set(project.members.map((m) => String(m)));
  for (const id of memberIds) {
    if (!existingSet.has(id)) {
      project.members.push(id as any);
      emitProjectMemberAdded(project.toObject(), id, String(project.organizationId));
      await createNotification({
        recipientId: id,
        organizationId: String(project.organizationId),
        title: "Assigned to Project",
        message: `You were added to project "${project.name}".`,
        type: "PROJECT",
        entityId: String(project._id),
      }).catch(() => {});
    }
  }

  await project.save();
  return project.toObject();
}

export async function removeProjectMember(projectId: string, memberId: string, user: any) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(project.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  project.members = project.members.filter((m) => String(m) !== String(memberId));
  await project.save();

  emitProjectMemberRemoved(project.toObject(), memberId, String(project.organizationId));
  return project.toObject();
}

export async function getProjectTasks(projectId: string, user: any) {
  const project = await Project.findById(projectId).lean();
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  if (user.role !== "SUPER_ADMIN" && String(project.organizationId) !== String(user.organizationId)) {
    throw new Error("FORBIDDEN");
  }

  const tasks = await Task.find({ projectId })
    .populate("assignedTo", "fullName email employeeId designation role")
    .populate("assignedBy", "fullName email employeeId designation role")
    .populate("teamId", "name code")
    .sort({ createdAt: -1 })
    .lean();

  return tasks;
}
