import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import Task from "../src/models/Task";
import Leave from "../src/models/Leave";
import Attendance from "../src/models/Attendance";
import { canUserAssignWorkTo, getManagementScope } from "../src/utils/scopeHelper";
import { validateTaskAssignment } from "../src/services/taskService";
import { createUser, updateUser } from "../src/services/userService";
import { createTeam, updateTeam, getTeamById } from "../src/services/teamService";

describe("20 Organizational Hierarchy & Role Authority Scenarios", () => {
  let mongoServer: MongoMemoryServer;
  let orgA: any;
  let orgB: any;
  let deptA: any;
  let deptB: any;

  let superAdmin: any;
  let adminA: any;
  let adminB: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    orgA = await Organization.create({
      name: "Acme Corp Org A",
      slug: "acme-corp-a",
      status: "ACTIVE",
    });

    orgB = await Organization.create({
      name: "Beta Global Org B",
      slug: "beta-global-b",
      status: "ACTIVE",
    });

    deptA = await Department.create({
      organizationId: orgA._id,
      name: "Engineering A",
    });

    deptB = await Department.create({
      organizationId: orgB._id,
      name: "Marketing B",
    });

    superAdmin = await User.create({
      fullName: "Super Admin User",
      email: "superadmin@system.test",
      passwordHash: "hash123",
      role: "SUPER_ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: null,
    });

    adminA = await User.create({
      fullName: "Admin User Org A",
      email: "adminA@acme.test",
      passwordHash: "hash123",
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: orgA._id,
      departmentId: String(deptA._id),
    });

    adminB = await User.create({
      fullName: "Admin User Org B",
      email: "adminB@beta.test",
      passwordHash: "hash123",
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: orgB._id,
      departmentId: String(deptB._id),
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // TEST 1: Create Employee A. Expected: role = EMPLOYEE.
  let employeeA: any;
  it("TEST 1: Create Employee A defaults to role = EMPLOYEE", async () => {
    employeeA = await createUser({
      fullName: "Employee Alice",
      email: "alice@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      designation: "Frontend Engineer",
    });

    expect(employeeA).toBeDefined();
    expect(employeeA.role).toBe("EMPLOYEE");
    expect(employeeA.designation).toBe("Frontend Engineer");
  });

  // TEST 2: Admin promotes Employee A to Team Lead. Expected: Employee A remains same User. role = TEAM_LEADER. Team assignment can be configured.
  it("TEST 2: Admin promotes Employee A to Team Lead (same user, role = TEAM_LEADER)", async () => {
    const originalId = String(employeeA._id || employeeA.id);
    const updated = await updateUser(originalId, {
      role: "TEAM_LEADER",
    });

    expect(String(updated._id || updated.id)).toBe(originalId);
    expect(updated.role).toBe("TEAM_LEADER");
    expect(updated.designation).toBe("Frontend Engineer");
    employeeA = updated;
  });

  // TEST 3: Admin promotes Employee B to Manager. Expected: Employee B remains same User. role = MANAGER.
  let employeeB: any;
  it("TEST 3: Admin promotes Employee B to Manager (same user, role = MANAGER)", async () => {
    employeeB = await createUser({
      fullName: "Employee Bob",
      email: "bob@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      designation: "Engineering Lead",
    });
    expect(employeeB.role).toBe("EMPLOYEE");

    const originalId = String(employeeB._id || employeeB.id);
    const updated = await updateUser(originalId, {
      role: "MANAGER",
    });

    expect(String(updated._id || updated.id)).toBe(originalId);
    expect(updated.role).toBe("MANAGER");
    expect(updated.designation).toBe("Engineering Lead");
    employeeB = updated;
  });

  // TEST 4: Manager B is assigned: Team A, Team B, Team C. Expected: Manager can access all three Teams.
  let teamA: any;
  let teamB: any;
  let teamC: any;
  it("TEST 4: Manager B is assigned Team A, Team B, Team C and can access all three", async () => {
    teamA = await createTeam({
      name: "Team Alpha",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      managerId: String(employeeB._id || employeeB.id),
      teamLeadId: String(employeeA._id || employeeA.id),
    });

    teamB = await createTeam({
      name: "Team Beta",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      managerId: String(employeeB._id || employeeB.id),
    });

    teamC = await createTeam({
      name: "Team Gamma",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      managerId: String(employeeB._id || employeeB.id),
    });

    const scope = await getManagementScope(employeeB);
    expect(scope.isManager).toBe(true);
    expect(scope.managedTeamIds).toContain(String(teamA._id));
    expect(scope.managedTeamIds).toContain(String(teamB._id));
    expect(scope.managedTeamIds).toContain(String(teamC._id));
  });

  // TEST 5: Team A has Team Lead A. Team B has Team Lead B. Team C has Team Lead C. Expected: Manager can access all three Team Leads. Team Lead A cannot access Team B.
  let teamLeadBUser: any;
  let teamLeadCUser: any;
  it("TEST 5: Manager accesses all three Team Leads, Team Lead A cannot access Team B", async () => {
    teamLeadBUser = await createUser({
      fullName: "Lead Brenda",
      email: "brenda@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
    });
    teamLeadBUser = await updateUser(String(teamLeadBUser._id || teamLeadBUser.id), {
      role: "TEAM_LEADER",
      teamId: String(teamB._id),
    });
    await updateTeam(String(teamB._id), { teamLeadId: String(teamLeadBUser._id || teamLeadBUser.id) });

    teamLeadCUser = await createUser({
      fullName: "Lead Charlie",
      email: "charlie@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
    });
    teamLeadCUser = await updateUser(String(teamLeadCUser._id || teamLeadCUser.id), {
      role: "TEAM_LEADER",
      teamId: String(teamC._id),
    });
    await updateTeam(String(teamC._id), { teamLeadId: String(teamLeadCUser._id || teamLeadCUser.id) });

    const managerScope = await getManagementScope(employeeB);
    expect(managerScope.scopedUserIds).toContain(String(employeeA._id || employeeA.id));
    expect(managerScope.scopedUserIds).toContain(String(teamLeadBUser._id || teamLeadBUser.id));
    expect(managerScope.scopedUserIds).toContain(String(teamLeadCUser._id || teamLeadCUser.id));

    const leadAScope = await getManagementScope(employeeA);
    expect(leadAScope.managedTeamIds).toContain(String(teamA._id));
    expect(leadAScope.managedTeamIds).not.toContain(String(teamB._id));
    expect(leadAScope.managedTeamIds).not.toContain(String(teamC._id));
  });

  // TEST 6: Team Lead A tries to access Employee belonging to Team B. Expected: 403 or blocked.
  let employeeUnderTeamB: any;
  it("TEST 6: Team Lead A trying to access Employee belonging to Team B is Blocked", async () => {
    employeeUnderTeamB = await createUser({
      fullName: "Employee David under Team B",
      email: "david@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      teamId: String(teamB._id),
    });

    const leadAScope = await getManagementScope(employeeA);
    expect(leadAScope.scopedUserIds).not.toContain(String(employeeUnderTeamB._id || employeeUnderTeamB.id));

    const canAssign = await canUserAssignWorkTo(employeeA, {
      targetUserId: String(employeeUnderTeamB._id || employeeUnderTeamB.id),
      targetTeamId: String(teamB._id),
    });
    expect(canAssign).toBe(false);
  });

  // TEST 7: Manager tries to access another Manager's Team. Expected: 403 or blocked.
  let managerOther: any;
  let teamOtherManager: any;
  it("TEST 7: Manager B attempting to access another Manager's Team is Blocked", async () => {
    managerOther = await createUser({
      fullName: "Manager Other",
      email: "othermgr@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
    });
    managerOther = await updateUser(String(managerOther._id || managerOther.id), { role: "MANAGER" });

    teamOtherManager = await createTeam({
      name: "Team Delta (Other Manager)",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      managerId: String(managerOther._id || managerOther.id),
    });

    const managerBScope = await getManagementScope(employeeB);
    expect(managerBScope.managedTeamIds).not.toContain(String(teamOtherManager._id));

    const canAssign = await canUserAssignWorkTo(employeeB, {
      targetTeamId: String(teamOtherManager._id),
    });
    expect(canAssign).toBe(false);
  });

  // TEST 8: Admin directly assigns work to Employee. Expected: Allowed.
  it("TEST 8: Admin directly assigns work to Employee (Allowed)", async () => {
    const allowed = await canUserAssignWorkTo(adminA, {
      targetUserId: String(employeeUnderTeamB._id || employeeUnderTeamB.id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(adminA, {
        title: "Direct Admin Task to Employee",
        assignedTo: String(employeeUnderTeamB._id || employeeUnderTeamB.id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 9: Admin directly assigns work to Team Lead. Expected: Allowed.
  it("TEST 9: Admin directly assigns work to Team Lead (Allowed)", async () => {
    const allowed = await canUserAssignWorkTo(adminA, {
      targetUserId: String(employeeA._id || employeeA.id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(adminA, {
        title: "Direct Admin Task to Team Lead",
        assignedTo: String(employeeA._id || employeeA.id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 10: Admin directly assigns work to Manager. Expected: Allowed.
  it("TEST 10: Admin directly assigns work to Manager (Allowed)", async () => {
    const allowed = await canUserAssignWorkTo(adminA, {
      targetUserId: String(employeeB._id || employeeB.id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(adminA, {
        title: "Direct Admin Task to Manager",
        assignedTo: String(employeeB._id || employeeB.id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 11: Team Lead assigns task to employee in their Team. Expected: Allowed.
  let employeeUnderTeamA: any;
  it("TEST 11: Team Lead A assigns task to employee in Team A (Allowed)", async () => {
    employeeUnderTeamA = await createUser({
      fullName: "Employee Emily under Team A",
      email: "emily@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      teamId: String(teamA._id),
    });

    const allowed = await canUserAssignWorkTo(employeeA, {
      targetUserId: String(employeeUnderTeamA._id || employeeUnderTeamA.id),
      targetTeamId: String(teamA._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(employeeA, {
        title: "Team A Sprint Task",
        assignedTo: String(employeeUnderTeamA._id || employeeUnderTeamA.id),
        teamId: String(teamA._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 12: Team Lead assigns task to employee from another Team. Expected: Blocked.
  it("TEST 12: Team Lead A assigning task to employee from Team B is Blocked", async () => {
    const allowed = await canUserAssignWorkTo(employeeA, {
      targetUserId: String(employeeUnderTeamB._id || employeeUnderTeamB.id),
      targetTeamId: String(teamB._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(employeeA, {
        title: "Unauthorized Cross-Team Task",
        assignedTo: String(employeeUnderTeamB._id || employeeUnderTeamB.id),
        teamId: String(teamB._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_OUTSIDE_SCOPE");
  });

  // TEST 13: Manager assigns task to employee in any of their Teams. Expected: Allowed.
  it("TEST 13: Manager B assigns task to employee in Team A and Team B (Allowed)", async () => {
    const allowedA = await canUserAssignWorkTo(employeeB, {
      targetUserId: String(employeeUnderTeamA._id || employeeUnderTeamA.id),
      targetTeamId: String(teamA._id),
    });
    expect(allowedA).toBe(true);

    const allowedB = await canUserAssignWorkTo(employeeB, {
      targetUserId: String(employeeUnderTeamB._id || employeeUnderTeamB.id),
      targetTeamId: String(teamB._id),
    });
    expect(allowedB).toBe(true);
  });

  // TEST 14: Manager assigns task to employee belonging to another Manager. Expected: Blocked.
  let employeeOtherManager: any;
  it("TEST 14: Manager B assigning task to employee of another Manager is Blocked", async () => {
    employeeOtherManager = await createUser({
      fullName: "Employee Frank (Other Manager)",
      email: "frank@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      teamId: String(teamOtherManager._id),
    });

    const allowed = await canUserAssignWorkTo(employeeB, {
      targetUserId: String(employeeOtherManager._id || employeeOtherManager.id),
      targetTeamId: String(teamOtherManager._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(employeeB, {
        title: "Cross Manager Task",
        assignedTo: String(employeeOtherManager._id || employeeOtherManager.id),
        teamId: String(teamOtherManager._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_OUTSIDE_SCOPE");
  });

  // TEST 15: Admin promotes Developer to Manager. Expected: Allowed (Designation preserved, role = MANAGER).
  it("TEST 15: Admin promotes Developer to Manager (designation preserved, role = MANAGER)", async () => {
    const dev = await createUser({
      fullName: "Grace Developer",
      email: "grace@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      designation: "Senior Backend Developer",
    });
    expect(dev.role).toBe("EMPLOYEE");
    expect(dev.designation).toBe("Senior Backend Developer");

    const promoted = await updateUser(String(dev._id || dev.id), { role: "MANAGER" });
    expect(promoted.role).toBe("MANAGER");
    expect(promoted.designation).toBe("Senior Backend Developer");
  });

  // TEST 16: Admin promotes Designer to Team Lead. Expected: Allowed (Designation preserved, role = TEAM_LEADER).
  it("TEST 16: Admin promotes Designer to Team Lead (designation preserved, role = TEAM_LEADER)", async () => {
    const designer = await createUser({
      fullName: "Helen Designer",
      email: "helen@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      designation: "Lead UI/UX Designer",
    });
    expect(designer.role).toBe("EMPLOYEE");
    expect(designer.designation).toBe("Lead UI/UX Designer");

    const promoted = await updateUser(String(designer._id || designer.id), { role: "TEAM_LEADER" });
    expect(promoted.role).toBe("TEAM_LEADER");
    expect(promoted.designation).toBe("Lead UI/UX Designer");
  });

  // TEST 17: Employee creation form. Expected: Manager/Team Lead are NOT required roles during initial creation. New user defaults to normal Employee.
  it("TEST 17: Employee creation defaults to normal Employee without requiring leadership role", async () => {
    const newEmp = await createUser({
      fullName: "Ian Intern",
      email: "ian@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
    });
    expect(newEmp.role).toBe("EMPLOYEE");
  });

  // TEST 18: Admin demotes Manager to Employee. Expected: User remains. Historical data remains. Management permissions are removed.
  it("TEST 18: Admin demotes Manager to Employee (user remains, management permissions removed, team manager cleared)", async () => {
    const mgrUser = await createUser({
      fullName: "Jack Demoted Manager",
      email: "jack@acme.test",
      password: "Password123!",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
    });
    const mgrId = String(mgrUser._id || mgrUser.id);
    await updateUser(mgrId, { role: "MANAGER" });

    // Assign team to Jack
    const testTeam = await createTeam({
      name: "Jack's Team",
      organizationId: String(orgA._id),
      departmentId: String(deptA._id),
      managerId: mgrId,
    });
    expect(testTeam.managerId).toBeDefined();

    // Create attendance and task for Jack
    await Attendance.create({
      userId: mgrId,
      organizationId: String(orgA._id),
      date: new Date(),
      status: "PRESENT",
      currentStatus: "ONLINE",
    });

    // Demote Jack to EMPLOYEE
    const demoted = await updateUser(mgrId, { role: "EMPLOYEE" });
    expect(demoted.role).toBe("EMPLOYEE");
    expect(String(demoted._id || demoted.id)).toBe(mgrId);

    // Jack's historical attendance is preserved
    const attCount = await Attendance.countDocuments({ userId: mgrId });
    expect(attCount).toBeGreaterThan(0);

    // Jack's management scope is now strictly employee level
    const scope = await getManagementScope(demoted);
    expect(scope.isManager).toBe(false);
    expect(scope.isEmployee).toBe(true);
    expect(scope.managedTeamIds).toHaveLength(0);

    // Team's manager is cleared
    const reloadedTeam = await getTeamById(String(testTeam._id));
    expect(reloadedTeam?.managerId).toBeNull();
  });

  // TEST 19: Organization isolation. Manager from Organization A tries to access Team from Organization B. Expected: Blocked.
  it("TEST 19: Organization isolation - Manager from Org A trying to assign work in Org B is Blocked", async () => {
    const teamInOrgB = await createTeam({
      name: "Beta Team in Org B",
      organizationId: String(orgB._id),
      departmentId: String(deptB._id),
    });

    const allowed = await canUserAssignWorkTo(employeeB, {
      targetTeamId: String(teamInOrgB._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(employeeB, {
        title: "Cross-Tenant Task",
        teamId: String(teamInOrgB._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_OUTSIDE_SCOPE");
  });

  // TEST 20: Super Admin. Expected: Existing elevated permissions continue working.
  it("TEST 20: Super Admin has system-wide permissions and can assign work to any user/team", async () => {
    const scope = await getManagementScope(superAdmin);
    expect(scope.isSuperAdmin).toBe(true);

    const allowedOrgA = await canUserAssignWorkTo(superAdmin, {
      targetUserId: String(employeeUnderTeamA._id || employeeUnderTeamA.id),
      targetTeamId: String(teamA._id),
    });
    expect(allowedOrgA).toBe(true);

    const empInOrgB = await createUser({
      fullName: "Org B Employee",
      email: "userOrgB@beta.test",
      password: "Password123!",
      organizationId: String(orgB._id),
      departmentId: String(deptB._id),
    });

    const allowedOrgB = await canUserAssignWorkTo(superAdmin, {
      targetUserId: String(empInOrgB._id || empInOrgB.id),
    });
    expect(allowedOrgB).toBe(true);

    await expect(
      validateTaskAssignment(superAdmin, {
        title: "Super Admin Platform Task",
        assignedTo: String(empInOrgB._id || empInOrgB.id),
      })
    ).resolves.not.toThrow();
  });
});
