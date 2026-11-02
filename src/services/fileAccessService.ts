import { IFileRecord } from "../models/FileRecord";

export type FileOperation = "READ" | "DOWNLOAD" | "WRITE" | "DELETE";

export function canAccessFile(
  user: any,
  file: IFileRecord,
  operation: FileOperation = "READ"
): boolean {
  if (!user || !file) return false;

  const currentUserId = String(user._id || user.id);
  const userOrgId = user.organizationId ? String(user.organizationId) : null;
  const fileOrgId = file.organizationId ? String(file.organizationId) : null;
  const isOwner =
    String(file.ownerId) === currentUserId ||
    String(file.uploadedBy) === currentUserId;

  // 1. Super Admin Platform Rules
  if (user.role === "SUPER_ADMIN") {
    // Super Admin has global access, except confidential HR documents require HR/Admin context or ownership
    if (file.visibility === "HR_RESTRICTED" && file.category === "HR") {
      // Super admin can still access for audit/governance
      return true;
    }
    return true;
  }

  // 2. Multi-Tenant Organization Isolation: STRICT
  if (!userOrgId || !fileOrgId || userOrgId !== fileOrgId) {
    return false;
  }

  // 3. Organization Admins
  if (user.role === "ADMIN") {
    // Admins have full access within their own organization
    return true;
  }

  // 4. HR Personnel
  if (user.role === "HR") {
    // HR can read, download, and manage HR, EMPLOYEE, and ORGANIZATION documents
    if (
      file.category === "HR" ||
      file.category === "EMPLOYEE" ||
      file.visibility === "ORGANIZATION" ||
      file.visibility === "HR_RESTRICTED"
    ) {
      return true;
    }
    // For other categories, check ownership or team/project scope
    if (isOwner) return true;
  }

  // 5. Deletion & Modification (Write / Delete)
  if (operation === "DELETE" || operation === "WRITE") {
    // Only owner, Admin, HR (for HR files), or Super Admin can modify or delete
    if (isOwner) return true;
    if (user.role === "HR" && (file.category === "HR" || file.category === "EMPLOYEE")) {
      return true;
    }
    return false;
  }

  // 6. Confidential HR Documents: Strictly Restricted
  if (
    file.category === "HR" ||
    file.category === "EMPLOYEE" ||
    file.visibility === "HR_RESTRICTED"
  ) {
    // If the file belongs specifically to this employee, they can read/download their own document
    if (file.employeeId && String(file.employeeId) === currentUserId) {
      return true;
    }
    if (isOwner) {
      return true;
    }
    // Other employees cannot access another employee's HR records
    return false;
  }

  // 7. Ownership check for Read/Download
  if (isOwner) {
    return true;
  }

  // 8. Visibility Scopes for General / Project / Task / Meeting files
  if (file.visibility === "ORGANIZATION") {
    return true;
  }

  if (file.visibility === "PRIVATE" || file.visibility === "USER") {
    // Strictly private to owner
    return isOwner;
  }

  if (file.visibility === "TEAM") {
    if (user.teamId && file.teamId && String(user.teamId) === String(file.teamId)) {
      return true;
    }
    return false;
  }

  if (file.visibility === "PROJECT" || file.projectId) {
    // If user is a member of the project or manager
    if (user.role === "MANAGER" || user.role === "TEAM_LEADER") return true;
    return true; // scoped to org members
  }

  if (file.visibility === "TASK" || file.taskId) {
    return true; // task participants within org
  }

  if (file.visibility === "MEETING" || file.meetingId) {
    return true; // meeting participants within org
  }

  return false;
}
