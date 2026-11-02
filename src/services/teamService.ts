import Team from "../models/Team";
import Organization from "../models/Organization";
import Department from "../models/Department";
import User from "../models/User";

export async function createTeam(payload: any) {
  const org = await Organization.findById(payload.organizationId).lean();
  if (!org) throw new Error("ORG_NOT_FOUND");
  const dept = await Department.findById(payload.departmentId).lean();
  if (!dept) throw new Error("DEPT_NOT_FOUND");
  if (String(dept.organizationId) !== String(payload.organizationId)) throw new Error("DEPT_ORG_MISMATCH");

  if (payload.managerId) {
    const mgr = await User.findById(payload.managerId).lean();
    if (!mgr) throw new Error("MANAGER_NOT_FOUND");
    if (mgr.organizationId && String(mgr.organizationId) !== String(payload.organizationId)) {
      throw new Error("MANAGER_ORG_MISMATCH");
    }
  }

  if (payload.teamLeadId) {
    const lead = await User.findById(payload.teamLeadId).lean();
    if (!lead) throw new Error("TEAM_LEAD_NOT_FOUND");
    if (lead.organizationId && String(lead.organizationId) !== String(payload.organizationId)) {
      throw new Error("TEAM_LEAD_ORG_MISMATCH");
    }
  }

  const created = await Team.create(payload);

  if (payload.teamLeadId) {
    await User.findByIdAndUpdate(payload.teamLeadId, {
      teamId: String(created._id),
      ...(payload.managerId ? { reportingManagerId: payload.managerId } : {}),
    });
  }

  return created.toObject();
}

export async function getTeamById(id: string) {
  return Team.findById(id)
    .populate("managerId", "fullName email employeeId role")
    .populate("teamLeadId", "fullName email employeeId role")
    .lean();
}

export async function listTeams(filter: any = {}, opts: any = {}) {
  const { skip = 0, limit = 50 } = opts;
  const items = await Team.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("managerId", "fullName email employeeId role")
    .populate("teamLeadId", "fullName email employeeId role")
    .lean();
  const total = await Team.countDocuments(filter);
  return { items, total };
}

export async function updateTeam(id: string, payload: any) {
  const existingTeam = await Team.findById(id).lean();
  if (!existingTeam) throw new Error("TEAM_NOT_FOUND");

  const orgId = payload.organizationId || existingTeam.organizationId;
  const deptId = payload.departmentId || existingTeam.departmentId;

  if (payload.organizationId || payload.departmentId) {
    const org = await Organization.findById(orgId).lean();
    const dept = await Department.findById(deptId).lean();
    if (!org) throw new Error("ORG_NOT_FOUND");
    if (!dept) throw new Error("DEPT_NOT_FOUND");
    if (String(dept.organizationId) !== String(orgId)) throw new Error("DEPT_ORG_MISMATCH");
  }

  if (payload.managerId !== undefined && payload.managerId !== null) {
    const mgr = await User.findById(payload.managerId).lean();
    if (!mgr) throw new Error("MANAGER_NOT_FOUND");
    if (mgr.organizationId && String(mgr.organizationId) !== String(orgId)) {
      throw new Error("MANAGER_ORG_MISMATCH");
    }
  }

  if (payload.teamLeadId !== undefined && payload.teamLeadId !== null) {
    const lead = await User.findById(payload.teamLeadId).lean();
    if (!lead) throw new Error("TEAM_LEAD_NOT_FOUND");
    if (lead.organizationId && String(lead.organizationId) !== String(orgId)) {
      throw new Error("TEAM_LEAD_ORG_MISMATCH");
    }
    await User.findByIdAndUpdate(payload.teamLeadId, {
      teamId: id,
      ...(payload.managerId || existingTeam.managerId ? { reportingManagerId: payload.managerId || existingTeam.managerId } : {}),
    });
  }

  const updated = await Team.findByIdAndUpdate(id, payload, { new: true })
    .populate("managerId", "fullName email employeeId role")
    .populate("teamLeadId", "fullName email employeeId role")
    .lean();
  return updated;
}

export async function setTeamStatus(id: string, status: string) {
  const updated = await Team.findByIdAndUpdate(id, { status }, { new: true }).lean();
  return updated;
}
