import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { parse } from 'url';
import { initSocket, closeSocket } from './lib/socket';
import { disconnectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './utils/logger';
import { checkRateLimit } from './middleware/rateLimiter';

/**
 * Dynamic route handler that matches patterns and imports the corresponding route file
 */
async function routeHandler(
  pathname: string,
  method: string,
  req: IncomingMessage,
): Promise<any> {
  // Auth routes
  if (pathname === '/api/auth/login') {
    return import('./app/api/auth/login/route');
  }
  if (pathname === '/api/auth/me' && method === 'GET') {
    return import('./app/api/auth/me/route');
  }

  // Leads routes
  if (pathname === '/api/leads' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/leads/route');
  }
  if (pathname === '/api/leads/import' && (method === 'POST' || method === 'GET')) {
    return import('./app/api/leads/import/route');
  }
  if (pathname === '/api/leads/analytics' && method === 'GET') {
    return import('./app/api/leads/analytics/route');
  }
  if (pathname === '/api/followups' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/followups/route');
  }

  // Dynamic lead ID routes
  const leadIdMatch = pathname.match(/^\/api\/leads\/([^/]+)(\/.*)?$/);
  if (leadIdMatch && !['import', 'analytics'].includes(leadIdMatch[1])) {
    const leadId = leadIdMatch[1];
    const subPath = leadIdMatch[2] || '';

    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/leads/[id]/route');
    }
    if (subPath === '/assign' && method === 'POST') {
      return import('./app/api/leads/[id]/assign/route');
    }
    if (subPath === '/calls' && (method === 'GET' || method === 'POST')) {
      return import('./app/api/leads/[id]/calls/route');
    }
    if (subPath === '/followups' && (method === 'GET' || method === 'POST')) {
      return import('./app/api/leads/[id]/followups/route');
    }
  }

  // Dynamic followup ID routes
  const followupIdMatch = pathname.match(/^\/api\/followups\/([^/]+)(\/.*)?$/);
  if (followupIdMatch) {
    const subPath = followupIdMatch[2] || '';
    if (subPath === '/complete' && method === 'POST') {
      return import('./app/api/followups/[id]/complete/route');
    }
  }

  // Leave types routes
  if (pathname === '/api/leave-types' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/leave-types/route');
  }

  // Leaves base routes
  if (pathname === '/api/leaves' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/leaves/route');
  }
  if (pathname === '/api/leaves/balance' && method === 'GET') {
    return import('./app/api/leaves/balance/route');
  }

  // Dynamic leave ID routes
  const leaveIdMatch = pathname.match(/^\/api\/leaves\/([^/]+)(\/.*)?$/);
  if (leaveIdMatch && leaveIdMatch[1] !== 'balance') {
    const subPath = leaveIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/leaves/[id]/route');
    }
    if (subPath === '/approve' && method === 'POST') {
      return import('./app/api/leaves/[id]/approve/route');
    }
    if (subPath === '/reject' && method === 'POST') {
      return import('./app/api/leaves/[id]/reject/route');
    }
    if (subPath === '/cancel' && method === 'POST') {
      return import('./app/api/leaves/[id]/cancel/route');
    }
  }

  // Hierarchy routes
  if (pathname === '/api/organization/hierarchy' && method === 'GET') {
    return import('./app/api/organization/hierarchy/route');
  }

  // Users routes
  if (pathname === '/api/users' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/users/route');
  }

  // Dynamic user ID routes
  const userIdMatch = pathname.match(/^\/api\/users\/([^/]+)(\/.*)?$/);
  if (userIdMatch) {
    const subPath = userIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/users/[id]/route');
    }
    if (subPath === '/access' && (method === 'GET' || method === 'PATCH')) {
      return import('./app/api/users/[id]/access/route');
    }
  }

  // Admin Control Center routes
  if (pathname === '/api/admin/control-center' && method === 'GET') {
    return import('./app/api/admin/control-center/route');
  }
  if (pathname === '/api/admin/security' && method === 'GET') {
    return import('./app/api/admin/security/route');
  }
  if (pathname === '/api/admin/health' && method === 'GET') {
    return import('./app/api/admin/health/route');
  }
  if (pathname === '/api/admin/roles' && method === 'GET') {
    return import('./app/api/admin/roles/route');
  }

  // Organizations routes
  if (pathname === '/api/organizations' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/organizations/route');
  }

  // Dynamic organization ID routes
  const orgIdMatch = pathname.match(/^\/api\/organizations\/([^/]+)(\/.*)?$/);
  if (orgIdMatch) {
    const subPath = orgIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/organizations/[id]/route');
    }
  }

  // Departments routes
  if (pathname === '/api/departments' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/departments/route');
  }
  const deptIdMatch = pathname.match(/^\/api\/departments\/([^/]+)(\/.*)?$/);
  if (deptIdMatch) {
    const subPath = deptIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/departments/[id]/route');
    }
  }

  // Documents (Employee Documents) routes
  if (pathname === '/api/documents' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/documents/route');
  }
  if (pathname === '/api/documents/checklist' && method === 'GET') {
    return import('./app/api/documents/checklist/route');
  }
  const docIdMatch = pathname.match(/^\/api\/documents\/([^/]+)(\/.*)?$/);
  if (docIdMatch && docIdMatch[1] !== 'checklist') {
    const subPath = docIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/documents/[id]/route');
    }
    if (subPath === '/verify' && method === 'POST') {
      return import('./app/api/documents/[id]/verify/route');
    }
  }

  // Attendance routes
  if (pathname === '/api/attendance' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/attendance/today/route');
  }
  if (pathname === '/api/attendance/today' && method === 'GET') {
    return import('./app/api/attendance/today/route');
  }
  if (pathname === '/api/attendance/login' && method === 'POST') {
    return import('./app/api/attendance/login/route');
  }
  if (pathname === '/api/attendance/logout' && method === 'POST') {
    return import('./app/api/attendance/logout/route');
  }
  if (pathname === '/api/attendance/break/start' && method === 'POST') {
    return import('./app/api/attendance/break/start/route');
  }
  if (pathname === '/api/attendance/break/end' && method === 'POST') {
    return import('./app/api/attendance/break/end/route');
  }
  if (pathname === '/api/attendance/break' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/attendance/today/route');
  }
  if (pathname === '/api/attendance/correct' && method === 'POST') {
    return import('./app/api/attendance/correct/route');
  }
  if (pathname === '/api/attendance/history' && method === 'GET') {
    return import('./app/api/attendance/history/route');
  }
  if (pathname === '/api/attendance/live' && method === 'GET') {
    return import('./app/api/attendance/live/route');
  }

  // Projects routes
  if (pathname === '/api/projects' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/projects/route');
  }
  const projectIdMatch = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
  if (projectIdMatch) {
    const subPath = projectIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/projects/[id]/route');
    }
  }

  // Meetings routes
  if (pathname === '/api/meetings' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/meetings/route');
  }
  const meetingIdMatch = pathname.match(/^\/api\/meetings\/([^/]+)(\/.*)?$/);
  if (meetingIdMatch) {
    const subPath = meetingIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/meetings/[id]/route');
    }
  }

  // Daily Work & EOD routes
  if (pathname === '/api/daily-report' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/daily-report/route');
  }
  if (pathname === '/api/daily-reports' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/daily-report/route');
  }
  if (pathname === '/api/daily-report/today' && method === 'GET') {
    return import('./app/api/daily-report/today/route');
  }
  const dailyReportIdMatch = pathname.match(/^\/api\/daily-report\/([^/]+)(\/.*)?$/);
  if (dailyReportIdMatch && dailyReportIdMatch[1] !== 'today') {
    const subPath = dailyReportIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/daily-report/[id]/route');
    }
    if (subPath === '/submit' && method === 'POST') {
      return import('./app/api/daily-report/[id]/submit/route');
    }
    if (subPath === '/review' && (method === 'POST' || method === 'PATCH')) {
      return import('./app/api/daily-report/[id]/review/route');
    }
    if (subPath === '/approve' && method === 'POST') {
      return import('./app/api/daily-report/[id]/approve/route');
    }
    if (subPath === '/return' && method === 'POST') {
      return import('./app/api/daily-report/[id]/return/route');
    }
  }

  // Compensation routes
  if (pathname === '/api/compensation' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/compensation/route');
  }
  if (pathname === '/api/compensation/me' && method === 'GET') {
    return import('./app/api/compensation/me/route');
  }
  if (pathname === '/api/compensation/history' && method === 'GET') {
    return import('./app/api/compensation/history/route');
  }
  if (pathname === '/api/compensation/users' && method === 'GET') {
    return import('./app/api/compensation/route');
  }
  const compUserMatch = pathname.match(/^\/api\/compensation\/users\/([^/]+)$/);
  if (compUserMatch && method === 'GET') {
    return import('./app/api/compensation/users/[id]/route');
  }
  const compIdMatch = pathname.match(/^\/api\/compensation\/([^/]+)(\/.*)?$/);
  if (compIdMatch && !['me', 'history', 'users'].includes(compIdMatch[1])) {
    const subPath = compIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/compensation/[id]/route');
    }
    if (subPath === '/status' && (method === 'PATCH' || method === 'POST')) {
      return import('./app/api/compensation/[id]/route');
    }
  }

  // Performance routes
  if (pathname === '/api/performance' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/performance/route');
  }
  if (pathname === '/api/performance/me' && method === 'GET') {
    return import('./app/api/performance/me/route');
  }
  if (pathname === '/api/performance/daily' && method === 'GET') {
    return import('./app/api/performance/daily/route');
  }
  if (pathname === '/api/performance/team' && method === 'GET') {
    return import('./app/api/performance/route');
  }
  const perfTeamMatch = pathname.match(/^\/api\/performance\/team\/([^/]+)$/);
  if (perfTeamMatch && method === 'GET') {
    return import('./app/api/performance/team/[id]/route');
  }
  if (pathname === '/api/performance/employee' && method === 'GET') {
    return import('./app/api/performance/route');
  }
  const perfEmpMatch = pathname.match(/^\/api\/performance\/employee\/([^/]+)$/);
  if (perfEmpMatch && method === 'GET') {
    return import('./app/api/performance/employee/[id]/route');
  }
  if (pathname === '/api/performance/history' && method === 'GET') {
    return import('./app/api/performance/history/route');
  }

  // Targets routes
  if (pathname === '/api/targets' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/targets/route');
  }
  const targetIdMatch = pathname.match(/^\/api\/targets\/([^/]+)(\/.*)?$/);
  if (targetIdMatch) {
    const subPath = targetIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/targets/[id]/route');
    }
  }

  // Points routes
  if (pathname === '/api/points' && method === 'GET') {
    return import('./app/api/points/history/route');
  }
  if (pathname === '/api/points/history' && method === 'GET') {
    return import('./app/api/points/history/route');
  }
  if (pathname === '/api/points/summary' && method === 'GET') {
    return import('./app/api/points/summary/route');
  }
  if (pathname === '/api/points/adjust' && method === 'POST') {
    return import('./app/api/points/adjust/route');
  }

  // Notifications routes
  if (pathname === '/api/notifications' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/notifications/route');
  }
  if (pathname === '/api/notifications/unread-count' && method === 'GET') {
    return import('./app/api/notifications/unread-count/route');
  }
  if (pathname === '/api/notifications/read-all' && (method === 'POST' || method === 'PATCH')) {
    return import('./app/api/notifications/read-all/route');
  }
  const notifIdMatch = pathname.match(/^\/api\/notifications\/([^/]+)(\/.*)?$/);
  if (notifIdMatch && !['unread-count', 'read-all'].includes(notifIdMatch[1])) {
    const subPath = notifIdMatch[2] || '';
    if (subPath === '/read' && (method === 'PATCH' || method === 'POST')) {
      return import('./app/api/notifications/[id]/read/route');
    }
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/notifications/[id]/read/route');
    }
  }

  // Reports routes
  if (pathname === '/api/reports' && method === 'GET') {
    return import('./app/api/reports/super-admin/route');
  }
  if (pathname === '/api/reports/super-admin' && method === 'GET') {
    return import('./app/api/reports/super-admin/route');
  }
  if (pathname === '/api/reports/admin' && method === 'GET') {
    return import('./app/api/reports/admin/route');
  }
  if (pathname === '/api/reports/export' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/reports/export/route');
  }
  const reportCatMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
  if (reportCatMatch && !['super-admin', 'admin', 'export'].includes(reportCatMatch[1])) {
    return import('./app/api/reports/[category]/route');
  }

  // Communication / Chat routes
  if (pathname === '/api/communication/conversations' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/communication/conversations/route');
  }
  const commConvMatch = pathname.match(/^\/api\/communication\/conversations\/([^/]+)(\/.*)?$/);
  if (commConvMatch) {
    const subPath = commConvMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/communication/conversations/[id]/route');
    }
    if (subPath === '/messages' && (method === 'GET' || method === 'POST')) {
      return import('./app/api/communication/conversations/[id]/messages/route');
    }
    if (subPath === '/read' && (method === 'POST' || method === 'PATCH')) {
      return import('./app/api/communication/conversations/[id]/read/route');
    }
  }
  const commMsgMatch = pathname.match(/^\/api\/communication\/messages\/([^/]+)$/);
  if (commMsgMatch) {
    return import('./app/api/communication/messages/[id]/route');
  }
  if (pathname === '/api/communication/users' && method === 'GET') {
    return import('./app/api/communication/users/route');
  }

  // Audit Logs routes
  if (pathname === '/api/audit-logs' && method === 'GET') {
    return import('./app/api/audit-logs/route');
  }

  // Settings routes
  if (pathname === '/api/settings' && (method === 'GET' || method === 'PATCH')) {
    return import('./app/api/settings/route');
  }

  // Health routes
  if (pathname === '/api/health' && method === 'GET') {
    return import('./app/api/health/route');
  }
  if (pathname === '/api/health/live' && method === 'GET') {
    return import('./app/api/health/live/route');
  }
  if (pathname === '/api/health/ready' && method === 'GET') {
    return import('./app/api/health/ready/route');
  }

  // Teams routes
  if (pathname === '/api/teams' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/teams/route');
  }
  const teamIdMatch = pathname.match(/^\/api\/teams\/([^/]+)(\/.*)?$/);
  if (teamIdMatch) {
    const subPath = teamIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/teams/[id]/route');
    }
  }

  // Tasks routes
  if (pathname === '/api/tasks' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/tasks/route');
  }
  const taskIdMatch = pathname.match(/^\/api\/tasks\/([^/]+)(\/.*)?$/);
  if (taskIdMatch) {
    const subPath = taskIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/tasks/[id]/route');
    }
    if (subPath === '/approve' && method === 'POST') {
      return import('./app/api/tasks/[id]/approve/route');
    }
    if (subPath === '/reject' && method === 'POST') {
      return import('./app/api/tasks/[id]/reject/route');
    }
    if (subPath === '/cancel' && method === 'POST') {
      return import('./app/api/tasks/[id]/cancel/route');
    }
  }

  // Dashboard routes
  if (pathname === '/api/dashboard' && method === 'GET') {
    return import('./app/api/dashboard/route');
  }
  if (pathname === '/api/dashboard/manager' && method === 'GET') {
    return import('./app/api/dashboard/manager/route');
  }
  if (pathname === '/api/dashboard/team-lead' && method === 'GET') {
    return import('./app/api/dashboard/team-lead/route');
  }
  if (pathname === '/api/dashboard/me' && method === 'GET') {
    return import('./app/api/dashboard/me/route');
  }
  if (pathname === '/api/dashboard/admin' && method === 'GET') {
    return import('./app/api/dashboard/admin/route');
  }
  if (pathname === '/api/dashboard/super-admin' && method === 'GET') {
    return import('./app/api/dashboard/super-admin/route');
  }

  // Announcements routes
  if (pathname === '/api/announcements' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/announcements/route');
  }
  if (pathname === '/api/announcements/unread-count' && method === 'GET') {
    return import('./app/api/announcements/unread-count/route');
  }
  const announcementIdMatch = pathname.match(/^\/api\/announcements\/([^/]+)(\/.*)?$/);
  if (announcementIdMatch && announcementIdMatch[1] !== 'unread-count') {
    const subPath = announcementIdMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/announcements/[id]/route');
    }
    if (subPath === '/publish' && method === 'POST') {
      return import('./app/api/announcements/[id]/publish/route');
    }
    if (subPath === '/schedule' && method === 'POST') {
      return import('./app/api/announcements/[id]/schedule/route');
    }
    if (subPath === '/archive' && method === 'POST') {
      return import('./app/api/announcements/[id]/archive/route');
    }
    if (subPath === '/read' && method === 'POST') {
      return import('./app/api/announcements/[id]/read/route');
    }
  }

  // Search routes
  if (pathname === '/api/search' && method === 'GET') {
    return import('./app/api/search/route');
  }
  if (pathname === '/api/search/suggestions' && method === 'GET') {
    return import('./app/api/search/suggestions/route');
  }

  // Files base routes
  if (pathname === '/api/files' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/files/route');
  }
  if (pathname === '/api/files/folders' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/files/folders/route');
  }
  const folderIdRouteMatch = pathname.match(/^\/api\/files\/folders\/([^/]+)$/);
  if (folderIdRouteMatch && (method === 'GET' || method === 'DELETE')) {
    return import('./app/api/files/folders/[id]/route');
  }

  // Dynamic file ID routes
  const fileIdRouteMatch = pathname.match(/^\/api\/files\/([^/]+)(\/.*)?$/);
  if (fileIdRouteMatch && fileIdRouteMatch[1] !== 'folders') {
    const subPath = fileIdRouteMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/files/[id]/route');
    }
    if (subPath === '/download' && method === 'GET') {
      return import('./app/api/files/[id]/download/route');
    }
    if (subPath === '/versions' && (method === 'GET' || method === 'POST')) {
      return import('./app/api/files/[id]/versions/route');
    }
    if (subPath === '/restore' && method === 'POST') {
      return import('./app/api/files/[id]/restore/route');
    }
  }

  // Centralized Document Management routes
  if (pathname === '/api/document-management/categories' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/document-management/categories/route');
  }
  if (pathname === '/api/document-management/types' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/document-management/types/route');
  }
  if (pathname === '/api/document-management/clients' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/document-management/clients/route');
  }
  if (pathname === '/api/document-management/allocations' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/document-management/allocations/route');
  }
  if (pathname === '/api/document-management/documents' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/document-management/documents/route');
  }
  const docMgmtDocMatch = pathname.match(/^\/api\/document-management\/documents\/([^/]+)(\/.*)?$/);
  if (docMgmtDocMatch) {
    const subPath = docMgmtDocMatch[2] || '';
    if (subPath === '' && (method === 'GET' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
      return import('./app/api/document-management/documents/[id]/route');
    }
    if (subPath === '/attachments' && (method === 'GET' || method === 'POST')) {
      return import('./app/api/document-management/documents/[id]/attachments/route');
    }
    const attachSubMatch = subPath.match(/^\/attachments\/([^/]+)$/);
    if (attachSubMatch && method === 'GET') {
      return import('./app/api/document-management/documents/[id]/attachments/[attachmentId]/route');
    }
  }

  // Generic Department Templates routes
  if (pathname === '/api/departments/templates' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/departments/templates/route');
  }

  // Central Permission Engine routes
  if (pathname === '/api/permissions/catalog' && method === 'GET') {
    return import('./app/api/permissions/catalog/route');
  }
  if (pathname === '/api/permissions/profiles' && (method === 'GET' || method === 'POST')) {
    return import('./app/api/permissions/profiles/route');
  }

  // Super Admin Control Center routes
  if (pathname === '/api/admin/control-center' && method === 'GET') {
    return import('./app/api/admin/control-center/route');
  }

  return null;
}

const MAX_BODY_SIZE_FILE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_BODY_SIZE_STANDARD_BYTES = 2 * 1024 * 1024; // 2MB

function applySecurityHeaders(res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Access-Control-Allow-Origin', env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

/**
 * HTTP request handler for testing with supertest and production server.
 * Delegates to Next.js App Router routes with security and production hardening.
 */
async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsedUrl = parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';
  const method = req.method || 'GET';
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

  applySecurityHeaders(res);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Rate Limiting
  const isAuthLogin = pathname === '/api/auth/login';
  const rateLimitOpts = isAuthLogin
    ? { windowMs: 60000, max: 15, keyPrefix: 'auth_login' }
    : { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX, keyPrefix: 'api' };

  const rateCheck = checkRateLimit(clientIp, rateLimitOpts);
  res.setHeader('X-RateLimit-Limit', String(rateCheck.limit));
  res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(rateCheck.resetTime / 1000)));

  if (!rateCheck.allowed) {
    res.statusCode = 429;
    res.setHeader('Retry-After', String(Math.ceil((rateCheck.resetTime - Date.now()) / 1000)));
    res.end(JSON.stringify({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please slow down and try again.' }
    }));
    return;
  }

  try {
    const routeModule = await routeHandler(pathname, method, req);

    if (!routeModule) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } }));
      return;
    }

    const routeAction = routeModule[method];
    if (!routeAction) {
      res.statusCode = 405;
      res.end(JSON.stringify({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: `Method ${method} not allowed` } }));
      return;
    }

    const url = `http://${req.headers.host || 'localhost'}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    let request: Request;

    if (method === 'GET' || method === 'HEAD') {
      request = new Request(url, {
        method,
        headers,
      });
    } else {
      const isFileUpload = pathname.startsWith('/api/files') || pathname.startsWith('/api/documents');
      const maxLimit = isFileUpload ? MAX_BODY_SIZE_FILE_BYTES : MAX_BODY_SIZE_STANDARD_BYTES;
      const bodyBuffer = await readBodyBuffer(req, maxLimit);
      const bodyText = bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer.toString('utf-8') : undefined;

      request = new Request(url, {
        method,
        headers,
        body: bodyText,
      });
    }

    // Extract dynamic params from pathname
    let params: Record<string, string> = {};

    const leadMatch = pathname.match(/^\/api\/leads\/([^/]+)/);
    const followupMatch = pathname.match(/^\/api\/followups\/([^/]+)/);
    const leaveMatch = pathname.match(/^\/api\/leaves\/([^/]+)/);
    const userMatch = pathname.match(/^\/api\/users\/([^/]+)/);
    const teamMatch = pathname.match(/^\/api\/teams\/([^/]+)/);
    const orgMatch = pathname.match(/^\/api\/organizations\/([^/]+)/);
    const deptMatch = pathname.match(/^\/api\/departments\/([^/]+)/);
    const docMatch = pathname.match(/^\/api\/documents\/([^/]+)/);
    const projMatch = pathname.match(/^\/api\/projects\/([^/]+)/);
    const meetMatch = pathname.match(/^\/api\/meetings\/([^/]+)/);
    const dailyRepMatch = pathname.match(/^\/api\/daily-report\/([^/]+)/);
    const compMatch = pathname.match(/^\/api\/compensation\/([^/]+)/);
    const targetMatch = pathname.match(/^\/api\/targets\/([^/]+)/);
    const notifMatch = pathname.match(/^\/api\/notifications\/([^/]+)/);
    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)/);
    const folderMatch = pathname.match(/^\/api\/files\/folders\/([^/]+)/);
    const fileMatch = pathname.match(/^\/api\/files\/([^/]+)/);
    const annMatch = pathname.match(/^\/api\/announcements\/([^/]+)/);
    const repCategoryMatch = pathname.match(/^\/api\/reports\/([^/]+)/);

    if (leadMatch && !['import', 'analytics'].includes(leadMatch[1])) {
      params.id = leadMatch[1];
    } else if (followupMatch) {
      params.id = followupMatch[1];
    } else if (leaveMatch && leaveMatch[1] !== 'balance') {
      params.id = leaveMatch[1];
    } else if (userMatch) {
      params.id = userMatch[1];
    } else if (teamMatch) {
      params.id = teamMatch[1];
    } else if (orgMatch) {
      params.id = orgMatch[1];
    } else if (deptMatch) {
      params.id = deptMatch[1];
    } else if (docMatch && docMatch[1] !== 'checklist') {
      params.id = docMatch[1];
    } else if (projMatch) {
      params.id = projMatch[1];
    } else if (meetMatch) {
      params.id = meetMatch[1];
    } else if (dailyRepMatch && dailyRepMatch[1] !== 'today') {
      params.id = dailyRepMatch[1];
    } else if (compMatch && !['me', 'history', 'users'].includes(compMatch[1])) {
      params.id = compMatch[1];
    } else if (targetMatch) {
      params.id = targetMatch[1];
    } else if (notifMatch && !['unread-count', 'read-all'].includes(notifMatch[1])) {
      params.id = notifMatch[1];
    } else if (taskMatch) {
      params.id = taskMatch[1];
    } else if (folderMatch) {
      params.id = folderMatch[1];
    } else if (fileMatch && fileMatch[1] !== 'folders') {
      params.id = fileMatch[1];
    } else if (annMatch && annMatch[1] !== 'unread-count') {
      params.id = annMatch[1];
    } else if (repCategoryMatch && !['super-admin', 'admin', 'export'].includes(repCategoryMatch[1])) {
      params.category = repCategoryMatch[1];
    }

    const docMgmtAttachMatch = pathname.match(/^\/api\/document-management\/documents\/([^/]+)\/attachments\/([^/]+)/);
    const docMgmtDocMatchParam = pathname.match(/^\/api\/document-management\/documents\/([^/]+)/);
    if (docMgmtAttachMatch) {
      params.id = docMgmtAttachMatch[1];
      params.attachmentId = docMgmtAttachMatch[2];
    } else if (docMgmtDocMatchParam && !['categories', 'types', 'clients', 'allocations'].includes(docMgmtDocMatchParam[1])) {
      params.id = docMgmtDocMatchParam[1];
    }

    const context = { params: Promise.resolve(params) };
    const response = await routeAction(request, context);
    res.statusCode = response.status;

    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (error: any) {
    if (error?.message === 'PAYLOAD_TOO_LARGE') {
      res.statusCode = 413;
      res.end(JSON.stringify({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds size limit' } }));
      return;
    }

    logger.error('Request processing error', { path: pathname, method, error: error?.message });
    res.statusCode = 500;
    const isProd = env.NODE_ENV === 'production';
    res.end(JSON.stringify({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: isProd ? 'An unexpected server error occurred' : (error?.message || 'Internal server error'),
      }
    }));
  }
}

/**
 * Read request body as Buffer with maximum size guard
 */
function readBodyBuffer(req: IncomingMessage, maxSizeBytes: number = MAX_BODY_SIZE_STANDARD_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // If request has already ended or has body attached
    if ((req as any).body && Buffer.isBuffer((req as any).body)) {
      return resolve((req as any).body);
    }
    if ((req as any)._body && typeof (req as any)._body === 'string') {
      return resolve(Buffer.from((req as any)._body, 'utf-8'));
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxSizeBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);

    // In case stream was already ended before listeners attached
    if (req.complete || (req as any).readableEnded) {
      resolve(Buffer.concat(chunks));
    }
  });
}

/**
 * Create and export the HTTP server for testing and production
 */
export const app = createServer(handler);
initSocket(app);

/**
 * Graceful shutdown logic
 */
export async function gracefulShutdown(signal: string = 'SIGTERM') {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  await closeSocket();
  await disconnectDatabase();
  return new Promise<void>((resolve) => {
    app.close(() => {
      logger.info('HTTP server closed successfully');
      resolve();
    });
  });
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').then(() => process.exit(0)).catch(() => process.exit(1));
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').then(() => process.exit(0)).catch(() => process.exit(1));
});
