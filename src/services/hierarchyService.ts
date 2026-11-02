import Division from "../models/Division";
import mongoose from "mongoose";
import Department from "../models/Department";
import Organization from "../models/Organization";
import Team from "../models/Team";
import User from "../models/User";
import { recordAuditLog } from "./auditLogService";
import { detectCircularReporting, getManagementScope } from "../utils/scopeHelper";

export async function getOrganizationHierarchy(authUser: any, targetOrgId?: string) {
  let orgId = targetOrgId || authUser.organizationId;
  if (!orgId && authUser.role !== "SUPER_ADMIN") {
    throw new Error("ORG_NOT_FOUND");
  }

  if (authUser.role !== "SUPER_ADMIN" && targetOrgId && String(targetOrgId) !== String(authUser.organizationId)) {
    throw new Error("FORBIDDEN_ORG_MISMATCH");
  }

  if (authUser.role === "SUPER_ADMIN" && !orgId) {
    const firstOrg = await Organization.findOne().lean();
    if (firstOrg) {
      orgId = String(firstOrg._id);
    }
  }

  const organization = orgId ? await Organization.findById(orgId).lean() : null;

  // Fetch departments, teams, users for the organization
  const orgFilter = orgId ? { organizationId: orgId } : {};

  const [divisions, departments, allTeams, allUsers] = await Promise.all([
    Division.find(orgFilter).sort({ name: 1 }).lean(),
    Department.find(orgFilter).sort({ name: 1 }).lean(),
    Team.find(orgFilter).sort({ name: 1 }).lean(),
    User.find(orgFilter)
      .select("_id employeeId fullName email phone role employmentType employmentStatus departmentId teamId reportingManagerId designation workLocation workMode status")
      .sort({ fullName: 1 })
      .lean(),
  ]);

  const activeUsers = allUsers.filter(
    (u) =>
      u.status !== "EXITED" &&
      u.status !== "TERMINATED" &&
      u.status !== "RESIGNED" &&
      u.status !== "INACTIVE" &&
      u.employmentStatus !== "EXITED" &&
      u.employmentStatus !== "TERMINATED" &&
      u.employmentStatus !== "RESIGNED"
  );

  // Summary counters
  const totalDepartments = departments.length;
  const totalTeams = allTeams.length;
  const totalManagers = activeUsers.filter((u) => u.role === "MANAGER").length;
  const totalTeamLeads = activeUsers.filter((u) => u.role === "TEAM_LEADER").length;
  const totalEmployees = activeUsers.filter((u) => u.employmentType === "EMPLOYEE" && u.role !== "SUPER_ADMIN" && u.role !== "ADMIN").length;
  const totalInterns = activeUsers.filter((u) => u.employmentType === "INTERN").length;

  const totalDivisions = divisions.length;
  const summary = {
    totalDivisions,
    totalDepartments,
    totalTeams,
    totalManagers,
    totalTeamLeads,
    totalEmployees,
    totalInterns,
  };

  // Build department hierarchy nodes
  const departmentNodes = departments.map((dept) => {
    const deptId = String(dept._id);
    const deptTeams = allTeams.filter((t) => String(t.departmentId) === deptId);
    const deptUsers = activeUsers.filter((u) => String(u.departmentId) === deptId);

    // Identify managers for this department
    const deptManagers = deptUsers.filter((u) => u.role === "MANAGER");
    const managerIdsInDept = new Set(deptManagers.map((m) => String(m._id)));

    // Teams assigned to each manager
    const managerNodes = deptManagers.map((mgr) => {
      const mgrId = String(mgr._id);
      const managedTeams = deptTeams.filter((t) => String(t.managerId) === mgrId);

      const teamNodes = managedTeams.map((team) => {
        const teamId = String(team._id);
        const teamLead = activeUsers.find((u) => String(u._id) === String(team.teamLeadId)) || null;
        const members = activeUsers.filter(
          (u) => String(u.teamId) === teamId && String(u._id) !== String(team.teamLeadId)
        );

        return {
          _id: teamId,
          name: team.name,
          code: team.code || "",
          status: team.status || "ACTIVE",
          departmentId: deptId,
          managerId: mgrId,
          teamLeadId: team.teamLeadId ? String(team.teamLeadId) : null,
          teamLead: teamLead
            ? {
                _id: String(teamLead._id),
                employeeId: teamLead.employeeId,
                fullName: teamLead.fullName,
                email: teamLead.email,
                role: teamLead.role,
                designation: teamLead.designation,
                status: teamLead.status,
                employmentType: teamLead.employmentType,
              }
            : null,
          memberCount: members.length + (teamLead ? 1 : 0),
          members: members.map((m) => ({
            _id: String(m._id),
            employeeId: m.employeeId,
            fullName: m.fullName,
            email: m.email,
            role: m.role,
            designation: m.designation,
            status: m.status,
            employmentType: m.employmentType,
            workLocation: m.workLocation,
            workMode: m.workMode,
          })),
        };
      });

      return {
        _id: mgrId,
        employeeId: mgr.employeeId,
        fullName: mgr.fullName,
        email: mgr.email,
        role: mgr.role,
        designation: mgr.designation,
        status: mgr.status,
        employmentType: mgr.employmentType,
        teamsCount: teamNodes.length,
        teams: teamNodes,
      };
    });

    // Unmanaged teams in this department (teams without manager or manager not in deptManagers)
    const unmanagedTeams = deptTeams
      .filter((t) => !t.managerId || !managerIdsInDept.has(String(t.managerId)))
      .map((team) => {
        const teamId = String(team._id);
        const teamLead = activeUsers.find((u) => String(u._id) === String(team.teamLeadId)) || null;
        const members = activeUsers.filter(
          (u) => String(u.teamId) === teamId && String(u._id) !== String(team.teamLeadId)
        );

        return {
          _id: teamId,
          name: team.name,
          code: team.code || "",
          status: team.status || "ACTIVE",
          departmentId: deptId,
          managerId: team.managerId ? String(team.managerId) : null,
          teamLeadId: team.teamLeadId ? String(team.teamLeadId) : null,
          teamLead: teamLead
            ? {
                _id: String(teamLead._id),
                employeeId: teamLead.employeeId,
                fullName: teamLead.fullName,
                email: teamLead.email,
                role: teamLead.role,
                designation: teamLead.designation,
                status: teamLead.status,
                employmentType: teamLead.employmentType,
              }
            : null,
          memberCount: members.length + (teamLead ? 1 : 0),
          members: members.map((m) => ({
            _id: String(m._id),
            employeeId: m.employeeId,
            fullName: m.fullName,
            email: m.email,
            role: m.role,
            designation: m.designation,
            status: m.status,
            employmentType: m.employmentType,
            workLocation: m.workLocation,
            workMode: m.workMode,
          })),
        };
      });

    // Unassigned employees in this department (not in any team and not a manager)
    const unassignedEmployees = deptUsers
      .filter((u) => !u.teamId && u.role !== "MANAGER")
      .map((m) => ({
        _id: String(m._id),
        employeeId: m.employeeId,
        fullName: m.fullName,
        email: m.email,
        role: m.role,
        designation: m.designation,
        status: m.status,
        employmentType: m.employmentType,
        workLocation: m.workLocation,
        workMode: m.workMode,
      }));

    return {
      _id: deptId,
      divisionId: dept.divisionId ? String(dept.divisionId) : null,
      isCentral: Boolean(dept.isCentral || !dept.divisionId),
      name: dept.name,
      code: dept.code || "",
      status: dept.status || "ACTIVE",
      managers: managerNodes,
      unmanagedTeams,
      unassignedEmployees,
    };
  });


  const divisionNodes = divisions.map((div: any) => {
    const divId = String(div._id);
    const divDepts = departmentNodes.filter((d: any) => d.divisionId === divId);
    const divHead = activeUsers.find((u) => String(u._id) === String(div.divisionHeadId)) || null;

    return {
      _id: divId,
      name: div.name,
      code: div.code,
      description: div.description || null,
      status: div.status || "ACTIVE",
      divisionHeadId: div.divisionHeadId ? String(div.divisionHeadId) : null,
      divisionHead: divHead
        ? {
            _id: String(divHead._id),
            employeeId: divHead.employeeId,
            fullName: divHead.fullName,
            email: divHead.email,
            role: divHead.role,
            designation: divHead.designation,
          }
        : null,
      departments: divDepts,
    };
  });

  const centralDepartments = departmentNodes.filter((d: any) => d.isCentral || !d.divisionId);

  // Filter tree based on user role scope
  if (authUser.role === "DIVISION_ADMIN") {
    const actorDivId = String(authUser.divisionId || authUser.primaryDivisionId || "");
    const scopedDivisions = divisionNodes.filter((d) => d._id === actorDivId);
    const scopedDepartments = departmentNodes.filter((d: any) => d.divisionId === actorDivId);

    return {
      organization,
      summary,
      divisions: scopedDivisions,
      centralDepartments: [],
      departments: scopedDepartments,
    };
  }

  if (authUser.role === "MANAGER") {
    const scope = await getManagementScope(authUser);
    const managedTeamIds = new Set(scope.managedTeamIds);

    const scopedDepartments = departmentNodes
      .map((dept) => {
        const myManagers = dept.managers.filter((m) => m._id === String(authUser._id));
        const myUnmanaged = dept.unmanagedTeams.filter((t) => managedTeamIds.has(t._id));

        if (myManagers.length === 0 && myUnmanaged.length === 0) return null;

        return {
          ...dept,
          managers: myManagers,
          unmanagedTeams: myUnmanaged,
          unassignedEmployees: [],
        };
      })
      .filter(Boolean);

    return {
      organization,
      summary,
      departments: scopedDepartments,
    };
  }

  if (authUser.role === "TEAM_LEADER") {
    const scope = await getManagementScope(authUser);
    const managedTeamIds = new Set(scope.managedTeamIds);

    const scopedDepartments = departmentNodes
      .map((dept) => {
        const filteredManagers = dept.managers
          .map((m) => ({
            ...m,
            teams: m.teams.filter((t) => managedTeamIds.has(t._id)),
          }))
          .filter((m) => m.teams.length > 0);

        const filteredUnmanaged = dept.unmanagedTeams.filter((t) => managedTeamIds.has(t._id));

        if (filteredManagers.length === 0 && filteredUnmanaged.length === 0) return null;

        return {
          ...dept,
          managers: filteredManagers,
          unmanagedTeams: filteredUnmanaged,
          unassignedEmployees: [],
        };
      })
      .filter(Boolean);

    return {
      organization,
      summary,
      departments: scopedDepartments,
    };
  }

  if (authUser.role !== "SUPER_ADMIN" && authUser.role !== "ADMIN") {
    // Regular employee: return only their team and direct reporting line
    const userTeamId = authUser.teamId ? String(authUser.teamId) : null;
    const userDeptId = authUser.departmentId ? String(authUser.departmentId) : null;

    const scopedDepartments = departmentNodes
      .filter((dept) => dept._id === userDeptId)
      .map((dept) => {
        const filteredManagers = dept.managers
          .map((m) => ({
            ...m,
            teams: m.teams.filter((t) => t._id === userTeamId),
          }))
          .filter((m) => m.teams.length > 0);

        const filteredUnmanaged = dept.unmanagedTeams.filter((t) => t._id === userTeamId);

        return {
          ...dept,
          managers: filteredManagers,
          unmanagedTeams: filteredUnmanaged,
          unassignedEmployees: dept.unassignedEmployees.filter((e) => e._id === String(authUser._id)),
        };
      });

    return {
      organization,
      summary,
      departments: scopedDepartments,
    };
  }

  return {
    organization,
    summary,
    divisions: divisionNodes,
    centralDepartments,
    departments: departmentNodes,
  };
}

export async function updateLeadershipRole(
  actorUser: any,
  targetUserId: string,
  payload: {
    action:
      | "MAKE_MANAGER"
      | "MAKE_TEAM_LEAD"
      | "REMOVE_MANAGER"
      | "REMOVE_TEAM_LEAD"
      | "REASSIGN_TEAM"
      | "REASSIGN_MANAGER"
      | "ASSIGN_TEAM_MANAGER"
      | "ASSIGN_TEAM_LEAD";
    teamId?: string | null;
    teamIds?: string[];
    departmentId?: string | null;
    managerId?: string | null;
    replacementManagerId?: string | null;
    replacementTeamLeadId?: string | null;
    reason?: string;
  }
) {
  const targetUser: any = await User.findById(targetUserId).lean();
  if (!targetUser) throw new Error("USER_NOT_FOUND");

  // Organization isolation check
  if (
    actorUser.role !== "SUPER_ADMIN" &&
    targetUser.organizationId &&
    String(targetUser.organizationId) !== String(actorUser.organizationId)
  ) {
    throw new Error("FORBIDDEN_ORG_MISMATCH");
  }

  const orgId = String(targetUser.organizationId || actorUser.organizationId || "");

  switch (payload.action) {
    case "MAKE_MANAGER": {
      // Promote existing user to Manager role, preserving base employmentType
      await User.findByIdAndUpdate(targetUserId, {
        role: "MANAGER",
        ...(payload.departmentId ? { departmentId: payload.departmentId } : {}),
      });

      // If teamIds provided, associate teams with this manager
      if (Array.isArray(payload.teamIds) && payload.teamIds.length > 0) {
        for (const tid of payload.teamIds) {
          const t: any = await Team.findById(tid).lean();
          if (t && String(t.organizationId) === orgId) {
            await Team.findByIdAndUpdate(tid, { managerId: targetUserId });
            // Update team members' reportingManagerId to this manager
            await User.updateMany({ teamId: tid }, { $set: { reportingManagerId: targetUserId } });
          }
        }
      }

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: "MANAGER_ASSIGNED",
        entityType: "USER",
        entityId: targetUserId,
        summary: `Promoted ${targetUser.fullName} to Manager`,
        metadata: {
          previousRole: targetUser.role,
          newRole: "MANAGER",
          assignedTeams: payload.teamIds || [],
          reason: payload.reason || "Leadership promotion",
        },
      });

      break;
    }

    case "MAKE_TEAM_LEAD": {
      if (!payload.teamId) {
        throw new Error("TEAM_ID_REQUIRED");
      }

      const team: any = await Team.findById(payload.teamId).lean();
      if (!team) throw new Error("TEAM_NOT_FOUND");
      if (team.organizationId && String(team.organizationId) !== orgId) {
        throw new Error("TEAM_ORG_MISMATCH");
      }

      // Promote user to Team Lead
      await User.findByIdAndUpdate(targetUserId, {
        role: "TEAM_LEADER",
        teamId: payload.teamId,
        departmentId: team.departmentId ? String(team.departmentId) : targetUser.departmentId,
        ...(team.managerId ? { reportingManagerId: String(team.managerId) } : {}),
      });

      // Update team's teamLeadId
      const previousTeamLead = team.teamLeadId || null;
      if (previousTeamLead && String(previousTeamLead) !== targetUserId) {
        await User.findByIdAndUpdate(previousTeamLead, { role: "EMPLOYEE" });
      }
      await Team.findByIdAndUpdate(payload.teamId, { teamLeadId: targetUserId });

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: previousTeamLead ? "TEAM_LEAD_CHANGED" : "TEAM_LEAD_ASSIGNED",
        entityType: "TEAM",
        entityId: payload.teamId,
        summary: `Assigned ${targetUser.fullName} as Team Lead for team ${team.name}`,
        metadata: {
          teamId: payload.teamId,
          previousTeamLead,
          newTeamLead: targetUserId,
          reason: payload.reason || "Team leadership assignment",
        },
      });

      break;
    }

    case "REMOVE_MANAGER": {
      // Find all teams managed by this manager
      const managedTeams = await Team.find({ managerId: targetUserId }).lean();
      const managedTeamIds = managedTeams.map((t) => String(t._id));

      if (payload.replacementManagerId) {
        const replacementMgr: any = await User.findById(payload.replacementManagerId).lean();
        if (!replacementMgr) throw new Error("REPLACEMENT_MANAGER_NOT_FOUND");
        if (replacementMgr.organizationId && String(replacementMgr.organizationId) !== orgId) {
          throw new Error("MANAGER_ORG_MISMATCH");
        }

        // Reassign managed teams to replacement manager
        await Team.updateMany({ managerId: targetUserId }, { $set: { managerId: payload.replacementManagerId } });
        await User.updateMany(
          { teamId: { $in: managedTeamIds } },
          { $set: { reportingManagerId: payload.replacementManagerId } }
        );
      } else {
        // Unset manager on managed teams safely
        await Team.updateMany({ managerId: targetUserId }, { $set: { managerId: null } });
      }

      // Demote role to EMPLOYEE
      await User.findByIdAndUpdate(targetUserId, { role: "EMPLOYEE" });

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: "MANAGER_REMOVED",
        entityType: "USER",
        entityId: targetUserId,
        summary: `Removed Manager responsibility from ${targetUser.fullName}`,
        metadata: {
          previousRole: targetUser.role,
          newRole: "EMPLOYEE",
          affectedTeams: managedTeamIds,
          reassignedToManager: payload.replacementManagerId || null,
          reason: payload.reason || "Manager responsibility removed",
        },
      });

      break;
    }

    case "REMOVE_TEAM_LEAD": {
      const leadingTeams = await Team.find({ teamLeadId: targetUserId }).lean();
      const leadingTeamIds = leadingTeams.map((t) => String(t._id));

      if (payload.replacementTeamLeadId) {
        const replacementLead: any = await User.findById(payload.replacementTeamLeadId).lean();
        if (!replacementLead) throw new Error("REPLACEMENT_LEAD_NOT_FOUND");
        if (replacementLead.organizationId && String(replacementLead.organizationId) !== orgId) {
          throw new Error("TEAM_LEAD_ORG_MISMATCH");
        }

        await Team.updateMany({ teamLeadId: targetUserId }, { $set: { teamLeadId: payload.replacementTeamLeadId } });
        await User.findByIdAndUpdate(payload.replacementTeamLeadId, {
          role: "TEAM_LEADER",
          ...(leadingTeamIds[0] ? { teamId: leadingTeamIds[0] } : {}),
        });
      } else {
        await Team.updateMany({ teamLeadId: targetUserId }, { $set: { teamLeadId: null } });
      }

      await User.findByIdAndUpdate(targetUserId, { role: "EMPLOYEE" });

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: "TEAM_LEAD_REMOVED",
        entityType: "USER",
        entityId: targetUserId,
        summary: `Removed Team Lead responsibility from ${targetUser.fullName}`,
        metadata: {
          previousRole: targetUser.role,
          newRole: "EMPLOYEE",
          affectedTeams: leadingTeamIds,
          reassignedToTeamLead: payload.replacementTeamLeadId || null,
          reason: payload.reason || "Team Lead responsibility removed",
        },
      });

      break;
    }

    case "REASSIGN_TEAM": {
      if (!payload.teamId) throw new Error("TEAM_ID_REQUIRED");

      const newTeam: any = await Team.findById(payload.teamId).lean();
      if (!newTeam) throw new Error("TEAM_NOT_FOUND");
      if (newTeam.organizationId && String(newTeam.organizationId) !== orgId) {
        throw new Error("TEAM_ORG_MISMATCH");
      }

      const oldTeamId = targetUser.teamId || null;

      // If user was team lead of old team, remove team leadership on old team
      if (oldTeamId && String(oldTeamId) !== String(payload.teamId)) {
        await Team.updateMany({ _id: oldTeamId, teamLeadId: targetUserId }, { $set: { teamLeadId: null } });
      }

      await User.findByIdAndUpdate(targetUserId, {
        teamId: payload.teamId,
        departmentId: newTeam.departmentId ? String(newTeam.departmentId) : targetUser.departmentId,
        reportingManagerId: newTeam.managerId ? String(newTeam.managerId) : targetUser.reportingManagerId,
      });

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: "EMPLOYEE_TEAM_CHANGED",
        entityType: "USER",
        entityId: targetUserId,
        summary: `Moved ${targetUser.fullName} to team ${newTeam.name}`,
        metadata: {
          oldTeamId,
          newTeamId: payload.teamId,
          newDepartmentId: newTeam.departmentId || null,
          reason: payload.reason || "Team reassignment",
        },
      });

      break;
    }

    case "REASSIGN_MANAGER": {
      if (!payload.managerId) throw new Error("MANAGER_ID_REQUIRED");

      // Validate circular reporting
      const isCircular = await detectCircularReporting(targetUserId, payload.managerId);
      if (isCircular) {
        throw new Error("CIRCULAR_REPORTING_DETECTED");
      }

      const mgr: any = await User.findById(payload.managerId).lean();
      if (!mgr) throw new Error("MANAGER_NOT_FOUND");
      if (mgr.organizationId && String(mgr.organizationId) !== orgId) {
        throw new Error("MANAGER_ORG_MISMATCH");
      }

      const oldManagerId = targetUser.reportingManagerId || null;
      await User.findByIdAndUpdate(targetUserId, { reportingManagerId: payload.managerId });

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: "EMPLOYEE_MANAGER_CHANGED",
        entityType: "USER",
        entityId: targetUserId,
        summary: `Changed reporting manager of ${targetUser.fullName} to ${mgr.fullName}`,
        metadata: {
          oldManagerId,
          newManagerId: payload.managerId,
          reason: payload.reason || "Reporting manager reassignment",
        },
      });

      break;
    }

    case "ASSIGN_TEAM_MANAGER": {
      if (!payload.teamId) throw new Error("TEAM_ID_REQUIRED");
      const team: any = await Team.findById(payload.teamId).lean();
      if (!team) throw new Error("TEAM_NOT_FOUND");
      if (team.organizationId && String(team.organizationId) !== orgId) {
        throw new Error("TEAM_ORG_MISMATCH");
      }

      if (payload.managerId) {
        const mgr: any = await User.findById(payload.managerId).lean();
        if (!mgr) throw new Error("MANAGER_NOT_FOUND");
        if (mgr.organizationId && String(mgr.organizationId) !== orgId) {
          throw new Error("MANAGER_ORG_MISMATCH");
        }
      }

      const oldManager = team.managerId || null;
      await Team.findByIdAndUpdate(payload.teamId, { managerId: payload.managerId || null });

      // Update members reporting line
      if (payload.managerId) {
        await User.updateMany({ teamId: payload.teamId }, { $set: { reportingManagerId: payload.managerId } });
      }

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: "TEAM_MANAGER_CHANGED",
        entityType: "TEAM",
        entityId: payload.teamId,
        summary: `Assigned manager for team ${team.name}`,
        metadata: {
          teamId: payload.teamId,
          oldManager,
          newManager: payload.managerId || null,
          reason: payload.reason || "Team manager assignment",
        },
      });

      break;
    }

    case "ASSIGN_TEAM_LEAD": {
      if (!payload.teamId) throw new Error("TEAM_ID_REQUIRED");
      const team: any = await Team.findById(payload.teamId).lean();
      if (!team) throw new Error("TEAM_NOT_FOUND");
      if (team.organizationId && String(team.organizationId) !== orgId) {
        throw new Error("TEAM_ORG_MISMATCH");
      }

      if (payload.replacementTeamLeadId) {
        const lead: any = await User.findById(payload.replacementTeamLeadId).lean();
        if (!lead) throw new Error("TEAM_LEAD_NOT_FOUND");
        if (lead.organizationId && String(lead.organizationId) !== orgId) {
          throw new Error("TEAM_LEAD_ORG_MISMATCH");
        }
        await User.findByIdAndUpdate(payload.replacementTeamLeadId, {
          role: "TEAM_LEADER",
          teamId: payload.teamId,
          ...(team.managerId ? { reportingManagerId: team.managerId } : {}),
        });
      }

      const oldLead = team.teamLeadId || null;
      if (oldLead && payload.replacementTeamLeadId && String(oldLead) !== String(payload.replacementTeamLeadId)) {
        await User.findByIdAndUpdate(oldLead, { role: "EMPLOYEE" });
      }

      await Team.findByIdAndUpdate(payload.teamId, {
        teamLeadId: payload.replacementTeamLeadId || null,
      });

      await recordAuditLog({
        organizationId: orgId,
        actorId: String(actorUser._id),
        actorRole: actorUser.role,
        action: oldLead ? "TEAM_LEAD_CHANGED" : "TEAM_LEAD_ASSIGNED",
        entityType: "TEAM",
        entityId: payload.teamId,
        summary: `Updated team lead for team ${team.name}`,
        metadata: {
          teamId: payload.teamId,
          oldLead,
          newLead: payload.replacementTeamLeadId || null,
          reason: payload.reason || "Team lead assignment",
        },
      });

      break;
    }

    default:
      throw new Error("INVALID_ACTION");
  }

  return User.findById(targetUserId).select("-passwordHash").lean();
}
