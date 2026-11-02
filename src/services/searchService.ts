import mongoose, { Types } from "mongoose";
import User from "../models/User";
import Task from "../models/Task";
import Project from "../models/Project";
import Meeting from "../models/Meeting";
import Conversation from "../models/Conversation";
import Message from "../models/Message";
import FileRecord from "../models/FileRecord";
import EmployeeDocument from "../models/EmployeeDocument";
import Department from "../models/Department";
import Team from "../models/Team";
import Leave from "../models/Leave";
import Announcement from "../models/Announcement";
import Organization from "../models/Organization";
import { buildUserAudienceQuery } from "./announcementService";

export type SearchEntityType =
  | "USER"
  | "DEPARTMENT"
  | "TEAM"
  | "TASK"
  | "PROJECT"
  | "MEETING"
  | "CONVERSATION"
  | "MESSAGE"
  | "FILE"
  | "HR_RECORD"
  | "LEAVE"
  | "ANNOUNCEMENT"
  | "ORGANIZATION";

export interface SearchResultItem {
  resultId: string;
  entityType: SearchEntityType;
  title: string;
  subtitle?: string;
  snippet?: string;
  relevanceScore?: number;
  route: string;
  organizationId?: string;
  metadata?: Record<string, any>;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface GlobalSearchResult {
  query: string;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  results: SearchResultItem[];
  grouped: Partial<Record<SearchEntityType, SearchResultItem[]>>;
}

export interface SearchSuggestionItem {
  resultId: string;
  entityType: SearchEntityType;
  title: string;
  subtitle?: string;
  route: string;
}

export interface SearchOptions {
  type?: string; // ALL or comma-separated e.g. "TASK,PROJECT"
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  organizationId?: string;
}

export const ALLOWED_SEARCH_ROLES = [
  "EMPLOYEE",
  "INTERN",
  "SALES_EXECUTIVE",
  "MANAGER",
  "TEAM_LEADER",
  "HR",
  "HR_MANAGER",
  "HR_EXECUTIVE",
  "ADMIN",
  "SUPER_ADMIN",
];

export function isSearchAllowedForRole(role: string): boolean {
  return ALLOWED_SEARCH_ROLES.includes(role);
}

/**
 * Escapes characters with special meaning in RegExp to prevent ReDoS / regex injection.
 */
export function escapeRegex(text: string): string {
  return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

/**
 * Derives the server-side scope for a Manager or Team Leader.
 * NEVER trusts client-provided departmentId/teamId.
 */
async function deriveManagerScope(user: any, orgId: any) {
  const userId = String(user._id || user.id);
  const userObjectId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : userId;

  // Find all teams where user is manager, teamLead, or belongs to
  const teams = await Team.find({
    organizationId: orgId,
    $or: [
      { managerId: userObjectId },
      { teamLeadId: userObjectId },
      ...(user.teamId ? [{ _id: user.teamId }] : []),
      ...(user.departmentId ? [{ departmentId: user.departmentId }] : []),
    ],
    status: "ACTIVE",
  }).select("_id departmentId managerId teamLeadId").lean();

  const managedTeamIds = teams.map((t) => t._id);
  const departmentId = user.departmentId || (teams.length > 0 ? teams[0].departmentId : null);

  // Find all user IDs belonging to these teams or department or reporting to manager
  const userQuery: any = {
    organizationId: orgId,
    $or: [
      { _id: userObjectId },
      { reportingManagerId: userObjectId },
      ...(managedTeamIds.length > 0 ? [{ teamId: { $in: managedTeamIds } }] : []),
      ...(departmentId ? [{ departmentId }] : []),
    ],
  };

  const scopedUsers = await User.find(userQuery).select("_id").lean();
  const scopedUserIds = [...new Set([userId, ...scopedUsers.map((u) => String(u._id))])];
  const scopedUserObjectIds = scopedUserIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  return {
    departmentId,
    managedTeamIds,
    scopedUserIds,
    scopedUserObjectIds,
  };
}

/**
 * Main Global Search Engine
 */
export async function globalSearch(
  rawQuery: string,
  user: any,
  options: SearchOptions = {}
): Promise<GlobalSearchResult> {
  const role = user.role || "EMPLOYEE";
  if (!isSearchAllowedForRole(role)) {
    throw new Error("FORBIDDEN");
  }

  const query = (rawQuery || "").trim();
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));

  if (!query || query.length < 2) {
    return {
      query,
      total: 0,
      page,
      limit,
      totalPages: 0,
      results: [],
      grouped: {},
    };
  }

  const escaped = escapeRegex(query);
  const regex = new RegExp(escaped, "i");

  const orgId = user.organizationId;
  const userId = String(user._id || user.id);
  const userObjectId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;

  const isSuperAdmin = role === "SUPER_ADMIN";
  const isAdmin = role === "ADMIN";
  const isHR = role === "HR" || role === "HR_MANAGER" || role === "HR_EXECUTIVE";
  const isManager = role === "MANAGER" || role === "TEAM_LEADER";

  // Derive manager scope server-side
  let managerScope: any = null;
  if (isManager && orgId) {
    managerScope = await deriveManagerScope(user, orgId);
  }

  // Parse type filter
  const requestedTypes: SearchEntityType[] = [];
  if (options.type && options.type.toUpperCase() !== "ALL") {
    const typeMap: Record<string, SearchEntityType> = {
      USER: "USER",
      USERS: "USER",
      EMPLOYEE: "USER",
      EMPLOYEES: "USER",
      DEPARTMENT: "DEPARTMENT",
      DEPARTMENTS: "DEPARTMENT",
      TEAM: "TEAM",
      TEAMS: "TEAM",
      TASK: "TASK",
      TASKS: "TASK",
      PROJECT: "PROJECT",
      PROJECTS: "PROJECT",
      MEETING: "MEETING",
      MEETINGS: "MEETING",
      CONVERSATION: "CONVERSATION",
      CONVERSATIONS: "CONVERSATION",
      MESSAGE: "MESSAGE",
      MESSAGES: "MESSAGE",
      FILE: "FILE",
      FILES: "FILE",
      DOCUMENT: "FILE",
      DOCUMENTS: "FILE",
      HR: "HR_RECORD",
      HR_RECORD: "HR_RECORD",
      HR_RECORDS: "HR_RECORD",
      LEAVE: "LEAVE",
      LEAVES: "LEAVE",
      ANNOUNCEMENT: "ANNOUNCEMENT",
      ANNOUNCEMENTS: "ANNOUNCEMENT",
      ORGANIZATION: "ORGANIZATION",
      ORGANIZATIONS: "ORGANIZATION",
    };

    const split = options.type.toUpperCase().split(",");
    for (const t of split) {
      const mapped = typeMap[t.trim()];
      if (mapped && !requestedTypes.includes(mapped)) {
        requestedTypes.push(mapped);
      }
    }
  }

  const shouldFetch = (entityType: SearchEntityType) => {
    if (requestedTypes.length === 0) return true;
    return requestedTypes.includes(entityType);
  };

  const tasksPromises: Promise<SearchResultItem[]>[] = [];

  // 1. USERS / EMPLOYEES
  if (shouldFetch("USER") && (orgId || isSuperAdmin)) {
    tasksPromises.push(
      (async () => {
        const userFilter: any = {
          $or: [
            { fullName: regex },
            { email: regex },
            { employeeId: regex },
            { designation: regex },
          ],
        };

        if (!isSuperAdmin) {
          userFilter.organizationId = orgId;
          userFilter.role = { $ne: "SUPER_ADMIN" };
        }

        if (!isSuperAdmin && !isAdmin && !isHR) {
          userFilter.status = { $nin: ["EXITED", "TERMINATED", "RESIGNED", "INACTIVE"] };
        }

        if (isManager && managerScope) {
          userFilter._id = { $in: managerScope.scopedUserObjectIds };
        }

        const users = await User.find(userFilter)
          .select("fullName email employeeId role designation departmentId teamId status createdAt")
          .limit(30)
          .lean();

        return users.map((u: any): SearchResultItem => ({
          resultId: String(u._id || u.employeeId),
          entityType: "USER",
          title: u.fullName || u.email,
          subtitle: `${u.designation || u.role} • ${u.employeeId || u.email}`,
          snippet: `Role: ${u.role} | Status: ${u.status || "ACTIVE"}`,
          route: "/hr",
          organizationId: String(u.organizationId || orgId || ""),
          metadata: {
            employeeId: u.employeeId,
            email: u.email,
            role: u.role,
            designation: u.designation,
          },
          createdAt: u.createdAt,
        }));
      })()
    );
  }

  // 2. DEPARTMENTS
  if (shouldFetch("DEPARTMENT") && (orgId || isSuperAdmin)) {
    tasksPromises.push(
      (async () => {
        const deptFilter: any = {
          $or: [{ name: regex }, { code: regex }, { description: regex }],
          status: "ACTIVE",
        };

        if (!isSuperAdmin) {
          deptFilter.organizationId = orgId;
        }

        if (isManager && managerScope?.departmentId) {
          deptFilter._id = managerScope.departmentId;
        } else if (isManager && !managerScope?.departmentId) {
          return [];
        }

        const departments = await Department.find(deptFilter)
          .select("name code description status createdAt")
          .limit(20)
          .lean();

        return departments.map((d: any): SearchResultItem => ({
          resultId: String(d._id),
          entityType: "DEPARTMENT",
          title: d.name,
          subtitle: `Department ${d.code ? `(${d.code})` : ""} • Status: ${d.status}`,
          snippet: d.description || `Department ${d.name}`,
          route: "/departments",
          organizationId: String(d.organizationId || orgId || ""),
          metadata: {
            departmentId: String(d._id),
            code: d.code,
            name: d.name,
          },
          createdAt: d.createdAt,
        }));
      })()
    );
  }

  // 3. TEAMS
  if (shouldFetch("TEAM") && (orgId || isSuperAdmin)) {
    tasksPromises.push(
      (async () => {
        const teamFilter: any = {
          $or: [{ name: regex }, { code: regex }, { description: regex }],
          status: "ACTIVE",
        };

        if (!isSuperAdmin) {
          teamFilter.organizationId = orgId;
        }

        if (isManager && managerScope) {
          if (managerScope.managedTeamIds.length === 0) return [];
          teamFilter._id = { $in: managerScope.managedTeamIds };
        }

        const teams = await Team.find(teamFilter)
          .select("name code description departmentId status createdAt")
          .limit(20)
          .lean();

        return teams.map((t: any): SearchResultItem => ({
          resultId: String(t._id),
          entityType: "TEAM",
          title: t.name,
          subtitle: `Team ${t.code ? `(${t.code})` : ""} • Status: ${t.status}`,
          snippet: t.description || `Team ${t.name}`,
          route: "/teams",
          organizationId: String(t.organizationId || orgId || ""),
          metadata: {
            teamId: String(t._id),
            code: t.code,
            name: t.name,
          },
          createdAt: t.createdAt,
        }));
      })()
    );
  }

  // 4. TASKS
  if (shouldFetch("TASK") && orgId) {
    tasksPromises.push(
      (async () => {
        const taskFilter: any = {
          organizationId: orgId,
          status: { $ne: "DELETED" },
          $or: [
            { title: regex },
            { description: regex },
            { taskId: regex },
            { tags: regex },
          ],
        };

        if (isManager && managerScope) {
          taskFilter.$or = [
            { assignedTo: { $in: managerScope.scopedUserObjectIds } },
            { creatorId: { $in: managerScope.scopedUserObjectIds } },
            { teamId: { $in: managerScope.managedTeamIds } },
          ];
          taskFilter.$and = [
            {
              $or: [
                { title: regex },
                { description: regex },
                { taskId: regex },
                { tags: regex },
              ],
            },
          ];
        } else if (!isSuperAdmin && !isAdmin && !isHR) {
          // Regular employees and interns strictly see only own assigned/created tasks
          taskFilter.$or = [
            { assignedTo: userObjectId },
            { createdBy: userObjectId },
            { assignedBy: userObjectId },
          ];
          taskFilter.$and = [
            {
              $or: [
                { title: regex },
                { description: regex },
                { taskId: regex },
                { tags: regex },
              ],
            },
          ];
        }

        const tasks = await Task.find(taskFilter)
          .select("taskId title description status priority dueDate tags createdAt")
          .limit(30)
          .lean();

        return tasks.map((t: any): SearchResultItem => ({
          resultId: t.taskId || String(t._id),
          entityType: "TASK",
          title: t.title,
          subtitle: `Task #${t.taskId} • Status: ${t.status} • Priority: ${t.priority}`,
          snippet: t.description ? t.description.substring(0, 120) : undefined,
          route: "/tasks",
          organizationId: String(orgId),
          metadata: {
            taskId: t.taskId,
            status: t.status,
            priority: t.priority,
            tags: t.tags || [],
          },
          createdAt: t.createdAt,
        }));
      })()
    );
  }

  // 5. PROJECTS
  if (shouldFetch("PROJECT") && orgId) {
    tasksPromises.push(
      (async () => {
        const projectFilter: any = {
          organizationId: orgId,
          status: { $ne: "DELETED" },
          $or: [{ name: regex }, { code: regex }, { description: regex }, { projectId: regex }],
        };

        if (isManager && managerScope) {
          projectFilter.$and = [
            {
              $or: [
                { members: { $in: managerScope.scopedUserObjectIds } },
                { ownerId: { $in: managerScope.scopedUserObjectIds } },
                { managerId: userObjectId },
              ],
            },
          ];
        }

        const projects = await Project.find(projectFilter)
          .select("projectId name code description status progress createdAt")
          .limit(30)
          .lean();

        return projects.map((p: any): SearchResultItem => ({
          resultId: p.projectId || String(p._id),
          entityType: "PROJECT",
          title: p.name,
          subtitle: `Project ${p.code || p.projectId} • Status: ${p.status} • Progress: ${p.progress || 0}%`,
          snippet: p.description ? p.description.substring(0, 120) : undefined,
          route: "/projects",
          organizationId: String(orgId),
          metadata: {
            projectId: p.projectId,
            code: p.code,
            status: p.status,
            progress: p.progress,
          },
          createdAt: p.createdAt,
        }));
      })()
    );
  }

  // 6. MEETINGS
  if (shouldFetch("MEETING") && orgId) {
    tasksPromises.push(
      (async () => {
        const meetingFilter: any = {
          organizationId: orgId,
          status: { $ne: "CANCELLED" },
          $or: [
            { title: regex },
            { description: regex },
            { meetingId: regex },
            { location: regex },
          ],
        };

        if (isManager && managerScope) {
          meetingFilter.$and = [
            {
              $or: [
                { organizerId: { $in: managerScope.scopedUserObjectIds } },
                { "participants.userId": { $in: managerScope.scopedUserObjectIds } },
              ],
            },
          ];
        }

        const meetings = await Meeting.find(meetingFilter)
          .select("meetingId title description date startTime status meetingType location createdAt")
          .limit(30)
          .lean();

        return meetings.map((m: any): SearchResultItem => ({
          resultId: m.meetingId || String(m._id),
          entityType: "MEETING",
          title: m.title,
          subtitle: `Meeting #${m.meetingId} • ${m.date || ""} ${m.startTime || ""} • ${m.meetingType || "ONLINE"}`,
          snippet: m.description ? m.description.substring(0, 120) : undefined,
          route: "/meetings",
          organizationId: String(orgId),
          metadata: {
            meetingId: m.meetingId,
            status: m.status,
            meetingType: m.meetingType,
            location: m.location,
          },
          createdAt: m.createdAt,
        }));
      })()
    );
  }

  // 7. CONVERSATIONS & MESSAGES
  if ((shouldFetch("CONVERSATION") || shouldFetch("MESSAGE")) && orgId && userObjectId) {
    tasksPromises.push(
      (async () => {
        const conversationFilter: any = {
          organizationId: orgId,
          isArchived: { $ne: true },
          participants: userObjectId,
        };

        const userConversations = await Conversation.find(conversationFilter)
          .select("conversationId name type participants lastMessage createdAt")
          .lean();

        const userConvIds = userConversations.map((c) => c._id);
        const results: SearchResultItem[] = [];

        if (shouldFetch("CONVERSATION")) {
          for (const conv of userConversations) {
            const matchesName = conv.name && regex.test(conv.name);
            const matchesId = conv.conversationId && regex.test(conv.conversationId);
            const matchesLastMsg = conv.lastMessage?.body && regex.test(conv.lastMessage.body);

            if (matchesName || matchesId || matchesLastMsg) {
              results.push({
                resultId: conv.conversationId || String(conv._id),
                entityType: "CONVERSATION",
                title: conv.name || `Chat (${conv.type})`,
                subtitle: `${conv.type} Conversation • ${conv.conversationId}`,
                snippet: conv.lastMessage?.body ? conv.lastMessage.body.substring(0, 100) : undefined,
                route: "/chat",
                organizationId: String(orgId),
                metadata: {
                  conversationId: conv.conversationId,
                  type: conv.type,
                },
                createdAt: conv.createdAt,
              });
            }
          }
        }

        if (shouldFetch("MESSAGE") && userConvIds.length > 0) {
          const messages = await Message.find({
            organizationId: orgId,
            conversationId: { $in: userConvIds },
            isDeleted: { $ne: true },
            body: regex,
          })
            .select("messageId conversationId body messageType createdAt")
            .limit(20)
            .lean();

          for (const msg of messages) {
            results.push({
              resultId: msg.messageId || String(msg._id),
              entityType: "MESSAGE",
              title: `Message in chat`,
              subtitle: msg.body.length > 60 ? `${msg.body.substring(0, 60)}...` : msg.body,
              snippet: msg.body,
              route: "/chat",
              organizationId: String(orgId),
              metadata: {
                messageId: msg.messageId,
                conversationId: String(msg.conversationId),
                messageType: msg.messageType,
              },
              createdAt: msg.createdAt,
            });
          }
        }

        return results;
      })()
    );
  }

  // 8. FILES / DOCUMENTS
  if (shouldFetch("FILE") && orgId) {
    tasksPromises.push(
      (async () => {
        const fileFilter: any = {
          organizationId: orgId,
          status: "ACTIVE",
          $or: [
            { originalName: regex },
            { description: regex },
            { tags: regex },
            { category: regex },
            { fileId: regex },
          ],
        };

        if (isManager && managerScope) {
          fileFilter.$and = [
            {
              $or: [
                { visibility: "ORGANIZATION" },
                { visibility: "TEAM", teamId: { $in: managerScope.managedTeamIds } },
                { uploadedBy: { $in: managerScope.scopedUserObjectIds } },
                { ownerId: { $in: managerScope.scopedUserObjectIds } },
              ],
            },
            { visibility: { $ne: "HR_RESTRICTED" } },
          ];
        }

        const files = await FileRecord.find(fileFilter)
          .select("fileId originalName description category extension size tags visibility version createdAt")
          .limit(30)
          .lean();

        return files.map((f: any): SearchResultItem => ({
          resultId: f.fileId || String(f._id),
          entityType: "FILE",
          title: f.originalName,
          subtitle: `File • ${f.category} • ${(f.size / 1024).toFixed(1)} KB • v${f.version || 1}`,
          snippet: f.description || `Tags: ${(f.tags || []).join(", ")}`,
          route: "/files",
          organizationId: String(orgId),
          metadata: {
            fileId: f.fileId,
            category: f.category,
            extension: f.extension,
            size: f.size,
            visibility: f.visibility,
            version: f.version,
          },
          createdAt: f.createdAt,
        }));
      })()
    );
  }

  // 9. HR RECORDS (Only for HR, Admin, Super Admin - NEVER Manager)
  if (shouldFetch("HR_RECORD") && (isHR || isAdmin || isSuperAdmin) && orgId) {
    tasksPromises.push(
      (async () => {
        const hrDocFilter: any = {
          organizationId: orgId,
          status: { $ne: "ARCHIVED" },
          $or: [
            { title: regex },
            { fileName: regex },
            { documentType: regex },
          ],
        };

        const hrDocs = await EmployeeDocument.find(hrDocFilter)
          .select("title documentType fileName status createdAt")
          .limit(20)
          .lean();

        return hrDocs.map((doc: any): SearchResultItem => ({
          resultId: String(doc._id),
          entityType: "HR_RECORD",
          title: doc.title || doc.fileName,
          subtitle: `HR Document • ${doc.documentType} • Status: ${doc.status}`,
          snippet: `Type: ${doc.documentType} (Status: ${doc.status})`,
          route: "/hr",
          organizationId: String(orgId),
          metadata: {
            documentType: doc.documentType,
            status: doc.status,
          },
          createdAt: doc.createdAt,
        }));
      })()
    );
  }

  // 10. LEAVES
  if (shouldFetch("LEAVE") && orgId) {
    tasksPromises.push(
      (async () => {
        const leaveFilter: any = {
          organizationId: orgId,
          $or: [
            { leaveTypeName: regex },
            { reason: regex },
          ],
        };

        if (isManager && managerScope) {
          leaveFilter.userId = { $in: managerScope.scopedUserObjectIds };
        }

        const leaves = await Leave.find(leaveFilter)
          .select("userId leaveTypeName reason totalDays status startDate endDate createdAt")
          .populate("userId", "fullName email employeeId")
          .limit(20)
          .lean();

        return leaves.map((l: any): SearchResultItem => ({
          resultId: String(l._id),
          entityType: "LEAVE",
          title: `${l.leaveTypeName} Leave (${(l.userId as any)?.fullName || "Employee"})`,
          subtitle: `${l.totalDays} Days • Status: ${l.status}`,
          snippet: `Reason: ${l.reason || "N/A"}`,
          route: "/attendance",
          organizationId: String(orgId),
          metadata: {
            leaveId: String(l._id),
            status: l.status,
            totalDays: l.totalDays,
          },
          createdAt: l.createdAt,
        }));
      })()
    );
  }

  // 11. ANNOUNCEMENTS
  if (shouldFetch("ANNOUNCEMENT") && (orgId || isSuperAdmin)) {
    tasksPromises.push(
      (async () => {
        let ancQuery: any;
        if (isSuperAdmin) {
          ancQuery = {
            $or: [{ title: regex }, { message: regex }],
          };
        } else if (isAdmin) {
          ancQuery = {
            organizationId: orgId,
            $or: [{ title: regex }, { message: regex }],
          };
        } else {
          ancQuery = {
            ...buildUserAudienceQuery(user),
            $or: [{ title: regex }, { message: regex }],
          };
        }

        const announcements = await Announcement.find(ancQuery)
          .select("announcementId title message priority status publishAt createdAt")
          .limit(20)
          .lean();

        return announcements.map((a: any): SearchResultItem => ({
          resultId: a.announcementId || String(a._id),
          entityType: "ANNOUNCEMENT",
          title: a.title,
          subtitle: `Announcement • Priority: ${a.priority} • Status: ${a.status}`,
          snippet: a.message.length > 120 ? `${a.message.substring(0, 117)}...` : a.message,
          route: "/announcements",
          organizationId: String(orgId || ""),
          metadata: {
            announcementId: a.announcementId,
            priority: a.priority,
            status: a.status,
          },
          createdAt: a.createdAt,
        }));
      })()
    );
  }

  // 12. ORGANIZATIONS (Super Admin Only)
  if (shouldFetch("ORGANIZATION") && isSuperAdmin) {
    tasksPromises.push(
      (async () => {
        const orgFilter: any = {
          $or: [{ name: regex }, { code: regex }, { organizationId: regex }],
        };

        const orgs = await Organization.find(orgFilter)
          .select("organizationId name code status createdAt")
          .limit(20)
          .lean();

        return orgs.map((o: any): SearchResultItem => ({
          resultId: o.organizationId || String(o._id),
          entityType: "ORGANIZATION",
          title: o.name,
          subtitle: `Organization Code: ${o.code || o.organizationId} • Status: ${o.status || "ACTIVE"}`,
          snippet: `ID: ${o.organizationId || o._id}`,
          route: "/organizations",
          organizationId: o.organizationId || String(o._id),
          metadata: {
            organizationId: o.organizationId,
            code: o.code,
            status: o.status,
          },
          createdAt: o.createdAt,
        }));
      })()
    );
  }

  const nestedResults = await Promise.all(tasksPromises);
  const allResults = nestedResults.flat();

  // Group by entityType
  const grouped: Partial<Record<SearchEntityType, SearchResultItem[]>> = {};
  for (const item of allResults) {
    if (!grouped[item.entityType]) {
      grouped[item.entityType] = [];
    }
    grouped[item.entityType]!.push(item);
  }

  // Calculate relevance sorting: exact prefix matches first
  const queryLower = query.toLowerCase();
  allResults.sort((a, b) => {
    const aTitleLower = a.title.toLowerCase();
    const bTitleLower = b.title.toLowerCase();
    const aStarts = aTitleLower.startsWith(queryLower);
    const bStarts = bTitleLower.startsWith(queryLower);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0);
  });

  const total = allResults.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const startIndex = (page - 1) * limit;
  const paginatedResults = allResults.slice(startIndex, startIndex + limit);

  return {
    query,
    total,
    page,
    limit,
    totalPages,
    results: paginatedResults,
    grouped,
  };
}

/**
 * Typeahead suggestions generator
 */
export async function getSuggestions(
  rawQuery: string,
  user: any
): Promise<SearchSuggestionItem[]> {
  const role = user.role || "EMPLOYEE";
  if (!isSearchAllowedForRole(role)) {
    throw new Error("FORBIDDEN");
  }

  const query = (rawQuery || "").trim();
  if (!query || query.length < 2) return [];

  const searchRes = await globalSearch(query, user, { limit: 8 });
  return searchRes.results.map((item) => ({
    resultId: item.resultId,
    entityType: item.entityType,
    title: item.title,
    subtitle: item.subtitle,
    route: item.route,
  }));
}
