import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User";
import Organization from "../models/Organization";
import Department from "../models/Department";
import Team from "../models/Team";
import { generateEmployeeId } from "../utils/employeeId";
import { assignDefaultDepartmentProfile, handleDepartmentTransfer } from "./centralPermissionService";

export async function createUser(payload: any) {
  const role = payload.role || "EMPLOYEE";
  const employmentType = payload.employmentType || "EMPLOYEE";
  const isEmployeeOrIntern =
    employmentType === "EMPLOYEE" ||
    employmentType === "INTERN" ||
    role === "EMPLOYEE" ||
    role === "INTERN";

  let passwordToUse = payload.password;
  let mustChangePassword = false;
  let passwordMetadata: any = null;

  if (isEmployeeOrIntern) {
    if (!passwordToUse || typeof passwordToUse !== "string" || passwordToUse.trim().length === 0) {
      passwordToUse = "Nexisparkx@123";
    }
    mustChangePassword = true;
    passwordMetadata = {
      temporaryPasswordAssignedAt: new Date(),
      defaultAssigned: passwordToUse === "Nexisparkx@123",
      assignedBy: payload.createdById || null,
    };
  } else {
    if (!passwordToUse || typeof passwordToUse !== "string" || passwordToUse.trim().length < 8) {
      throw new Error("PASSWORD_REQUIRED");
    }
  }

  // validate unique email
  const existing = await User.findOne({ email: payload.email.toLowerCase() }).lean();
  if (existing) throw new Error("EMAIL_EXISTS");

  let orgId = (payload.organizationId && mongoose.Types.ObjectId.isValid(payload.organizationId)) ? payload.organizationId : null;
  let deptId = (payload.departmentId && String(payload.departmentId).trim().length > 0) ? payload.departmentId : null;
  let teamId = (payload.teamId && String(payload.teamId).trim().length > 0) ? payload.teamId : null;
  let managerId = (payload.reportingManagerId && mongoose.Types.ObjectId.isValid(payload.reportingManagerId)) ? payload.reportingManagerId : null;

  // validate organization/department/team relationships
  if (orgId) {
    const org = await Organization.findById(orgId).lean();
    if (!org) throw new Error("ORG_NOT_FOUND");
  }

  if (deptId) {
    const dept = await Department.findById(deptId).lean();
    if (!dept) throw new Error("DEPT_NOT_FOUND");
    if (!orgId && dept.organizationId) {
      orgId = String(dept.organizationId);
    }
  }

  if (teamId) {
    const team = await Team.findById(teamId).lean();
    if (!team) throw new Error("TEAM_NOT_FOUND");
    if (deptId && team.departmentId && String(team.departmentId) !== String(deptId)) {
      // If team doesn't match dept, clear invalid team
      teamId = null;
    }
  }

  // generate employeeId
  const empId = await generateEmployeeId(payload.employmentType || "EMPLOYEE");

  // password handling - store only secure hash
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(passwordToUse, salt);

  const userDoc: Record<string, any> = {
    employeeId: empId,
    fullName: payload.fullName,
    displayName: payload.displayName || payload.fullName,
    email: payload.email.toLowerCase(),
    passwordHash,
    mustChangePassword,
    passwordMetadata,
    role: payload.role || "EMPLOYEE",
    employmentType: payload.employmentType || "EMPLOYEE",
    employmentClassification: payload.employmentClassification || (payload.employmentType === "INTERN" || payload.role === "INTERN" ? "FULL_TIME_INTERN" : "FULL_TIME_EMPLOYEE"),
    employmentStatus: payload.employmentStatus || payload.status || "ACTIVE",
    status: payload.status || payload.employmentStatus || "ACTIVE",
    country: payload.country || "India",
    organizationId: orgId || null,
    divisionId: payload.divisionId || null,
    primaryDivisionId: payload.divisionId || null,
    departmentId: deptId || null,
    teamId: teamId || null,
    reportingManagerId: managerId || null,
  };

  if (payload.firstName) userDoc.firstName = payload.firstName;
  if (payload.middleName) userDoc.middleName = payload.middleName;
  if (payload.lastName) userDoc.lastName = payload.lastName;
  if (payload.phone || payload.primaryPhone) {
    userDoc.phone = payload.phone || payload.primaryPhone;
    userDoc.primaryPhone = payload.primaryPhone || payload.phone;
  }
  if (payload.personalEmail) userDoc.personalEmail = payload.personalEmail;
  if (payload.officialEmail) userDoc.officialEmail = payload.officialEmail;
  if (payload.alternatePhone) userDoc.alternatePhone = payload.alternatePhone;
  if (payload.dateOfBirth) userDoc.dateOfBirth = new Date(payload.dateOfBirth);
  if (payload.gender) userDoc.gender = payload.gender;
  if (payload.maritalStatus) userDoc.maritalStatus = payload.maritalStatus;
  if (payload.currentAddress) userDoc.currentAddress = payload.currentAddress;
  if (payload.permanentAddress) userDoc.permanentAddress = payload.permanentAddress;
  if (payload.city) userDoc.city = payload.city;
  if (payload.state) userDoc.state = payload.state;
  if (payload.postalCode) userDoc.postalCode = payload.postalCode;
  if (payload.emergencyContactName) userDoc.emergencyContactName = payload.emergencyContactName;
  if (payload.emergencyContactRelation) userDoc.emergencyContactRelation = payload.emergencyContactRelation;
  if (payload.emergencyContactPhone) userDoc.emergencyContactPhone = payload.emergencyContactPhone;
  if (payload.emergencyContactAlternatePhone) userDoc.emergencyContactAlternatePhone = payload.emergencyContactAlternatePhone;
  if (payload.designation) userDoc.designation = payload.designation;
  if (payload.departmentProfileId) userDoc.departmentProfileId = payload.departmentProfileId;
  if (payload.designationProfileId) userDoc.designationProfileId = payload.designationProfileId;
  if (payload.joiningDate) userDoc.joiningDate = new Date(payload.joiningDate);
  if (payload.internshipStartDate) userDoc.internshipStartDate = new Date(payload.internshipStartDate);
  if (payload.internshipEndDate) userDoc.internshipEndDate = new Date(payload.internshipEndDate);
  if (payload.evaluationPeriodMonths) userDoc.evaluationPeriodMonths = Number(payload.evaluationPeriodMonths);
  if (payload.provisionStipend) userDoc.provisionStipend = Number(payload.provisionStipend);
  if (payload.confirmedStipend) userDoc.confirmedStipend = Number(payload.confirmedStipend);
  if (payload.confirmedStipendEffectiveDate) userDoc.confirmedStipendEffectiveDate = new Date(payload.confirmedStipendEffectiveDate);
  if (payload.workLocation) userDoc.workLocation = payload.workLocation;
  if (payload.workMode) userDoc.workMode = payload.workMode;
  if (payload.profilePhoto) userDoc.profilePhoto = payload.profilePhoto;

  const created = await User.create(userDoc);

  if (created.departmentId && !created.departmentProfileId) {
    try {
      const dept = await Department.findById(created.departmentId).select("code name").lean();
      if (dept) {
        await assignDefaultDepartmentProfile(created, dept.code || dept.name);
      }
    } catch {
      // non-fatal
    }
  }

  const obj = created.toObject();
  delete (obj as any).passwordHash;
  return obj;
}

export async function getUserById(id: string) {
  const u: any = await User.findById(id).select("-passwordHash").lean();
  if (!u) return null;

  // Enrich with organizational hierarchy data
  let department: any = null;
  let team: any = null;
  let teamLead: any = null;
  let manager: any = null;
  let managedTeams: any[] = [];
  let leadingTeam: any = null;

  if (u.departmentId) {
    department = await Department.findById(u.departmentId).select("_id name code").lean();
  }

  if (u.teamId) {
    team = await Team.findById(u.teamId).select("_id name code managerId teamLeadId").lean();
    if (team) {
      if (team.teamLeadId) {
        teamLead = await User.findById(team.teamLeadId).select("_id fullName email employeeId designation role").lean();
      }
      if (team.managerId) {
        manager = await User.findById(team.managerId).select("_id fullName email employeeId designation role").lean();
      }
    }
  }

  if (!manager && u.reportingManagerId) {
    manager = await User.findById(u.reportingManagerId).select("_id fullName email employeeId designation role").lean();
  }

  if (u.role === "MANAGER") {
    const teams = await Team.find({ managerId: id, status: "ACTIVE" })
      .populate("teamLeadId", "_id fullName email employeeId designation")
      .select("_id name code teamLeadId status departmentId")
      .lean();

    // Attach member counts
    managedTeams = await Promise.all(
      teams.map(async (t) => {
        const memberCount = await User.countDocuments({ teamId: String(t._id), status: "ACTIVE" });
        return { ...t, memberCount };
      })
    );
  }

  if (u.role === "TEAM_LEADER") {
    const leadTeam = await Team.findOne({
      $or: [{ teamLeadId: id }, ...(u.teamId ? [{ _id: u.teamId }] : [])],
      status: "ACTIVE",
    })
      .populate("managerId", "_id fullName email employeeId designation")
      .select("_id name code managerId status departmentId")
      .lean();

    if (leadTeam) {
      const members = await User.find({
        teamId: String(leadTeam._id),
        _id: { $ne: id },
        status: { $nin: ["EXITED", "TERMINATED", "RESIGNED", "INACTIVE"] },
        employmentStatus: { $nin: ["EXITED", "TERMINATED", "RESIGNED"] },
      })
        .select("_id fullName email employeeId designation role status employmentType")
        .lean();
      leadingTeam = { ...leadTeam, members };
    }
  }

  return {
    ...u,
    department,
    departmentName: department?.name || null,
    team,
    teamName: team?.name || null,
    teamLead,
    teamLeadName: teamLead?.fullName || null,
    manager,
    managerName: manager?.fullName || null,
    managedTeams,
    leadingTeam,
  };
}

export async function listUsers(query: any) {
  const { page = 1, limit = 50, search, filters = {}, sort = { createdAt: -1 } } = query;
  const skip = (page - 1) * limit;
  const q: any = { ...filters };
  if (!filters.status && !filters.employmentStatus && !filters._id && !query.includeInactive) {
    q.status = { $nin: ["EXITED", "TERMINATED", "RESIGNED", "INACTIVE"] };
  }
  if (search) {
    const s = new RegExp(search, "i");
    q.$or = [{ employeeId: s }, { fullName: s }, { email: s }, { phone: s }];
  }
  const items = await User.find(q).skip(skip).limit(limit).select("-passwordHash").sort(sort).lean();
  const total = await User.countDocuments(q);
  return { items, total };
}

export async function updateUser(id: string, payload: any) {
  if (payload.organizationId) {
    const org = await Organization.findById(payload.organizationId).lean();
    if (!org) throw new Error("ORG_NOT_FOUND");
  }
  if (payload.departmentId) {
    const dept = await Department.findById(payload.departmentId).lean();
    if (!dept) throw new Error("DEPT_NOT_FOUND");
  }
  if (payload.teamId) {
    const team = await Team.findById(payload.teamId).lean();
    if (!team) throw new Error("TEAM_NOT_FOUND");
  }

  if (payload.email) {
    const existing = await User.findOne({ email: payload.email.toLowerCase(), _id: { $ne: id } }).lean();
    if (existing) throw new Error("EMAIL_EXISTS");
  }

  const existingUser = await User.findById(id).lean();
  if (!existingUser) throw new Error("USER_NOT_FOUND");

  // Handle role change side-effects
  if (payload.role && payload.role !== existingUser.role) {
    if (existingUser.role === "MANAGER" && payload.role !== "MANAGER") {
      // Demoted from Manager: remove manager authority on all teams
      await Team.updateMany({ managerId: id }, { $set: { managerId: null } });
    }

    if (existingUser.role === "TEAM_LEADER" && payload.role !== "TEAM_LEADER") {
      // Demoted from Team Leader: remove team lead authority on all teams
      await Team.updateMany({ teamLeadId: id }, { $set: { teamLeadId: null } });
    }
  }

  // If user moved to another team, clear team leadership on previous team
  if (payload.teamId && existingUser.teamId && String(payload.teamId) !== String(existingUser.teamId)) {
    await Team.updateMany({ _id: existingUser.teamId, teamLeadId: id }, { $set: { teamLeadId: null } });
  }

  // If user moved to another department, recalculate permissions and clear old department profile
  if (payload.departmentId && existingUser.departmentId && String(payload.departmentId) !== String(existingUser.departmentId)) {
    try {
      const targetDept = await Department.findById(payload.departmentId).select("code name").lean();
      await handleDepartmentTransfer(existingUser, String(payload.departmentId), targetDept?.code || targetDept?.name, payload.role);
    } catch {
      // non-fatal fallback
    }
  }

  const updateData: any = {};
  const unsetData: any = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === "") {
      if (["gender", "maritalStatus", "workMode", "profilePhoto", "personalEmail", "alternatePhone"].includes(key)) {
        unsetData[key] = "";
      }
    } else {
      updateData[key] = value;
    }
  }

  if (updateData.status && !updateData.employmentStatus) {
    updateData.employmentStatus = updateData.status;
  } else if (updateData.employmentStatus && !updateData.status) {
    updateData.status = updateData.employmentStatus;
  }

  if (updateData.dateOfBirth && typeof updateData.dateOfBirth === "string") {
    updateData.dateOfBirth = new Date(updateData.dateOfBirth);
  }
  if (updateData.joiningDate && typeof updateData.joiningDate === "string") {
    updateData.joiningDate = new Date(updateData.joiningDate);
  }

  const mongoUpdate: any = {};
  if (Object.keys(updateData).length > 0) mongoUpdate.$set = updateData;
  if (Object.keys(unsetData).length > 0) mongoUpdate.$unset = unsetData;

  const updated = await User.findByIdAndUpdate(id, mongoUpdate, { new: true, runValidators: true }).select("-passwordHash").lean();
  return updated;
}

export async function setUserStatus(id: string, status: string) {
  const updated = await User.findByIdAndUpdate(id, { status }, { new: true }).select("-passwordHash").lean();
  return updated;
}

export async function softDeleteUser(id: string) {
  const updated = await User.findByIdAndUpdate(id, { status: "RESIGNED" }, { new: true }).select("-passwordHash").lean();
  return updated;
}
