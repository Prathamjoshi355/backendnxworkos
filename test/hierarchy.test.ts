import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import Task from "../src/models/Task";
import Leave from "../src/models/Leave";
import { canUserAssignWorkTo, getManagementScope } from "../src/utils/scopeHelper";
import { validateTaskAssignment } from "../src/services/taskService";

describe("Organizational Hierarchy & Manager Authority Scoping", () => {
  let mongoServer: MongoMemoryServer;
  let org1: any;
  let org2: any;
  let dept1: any;
  let dept2: any;

  let superAdmin: any;
  let adminOrg1: any;
  let adminOrg2: any;

  let managerA: any;
  let managerB: any;

  let teamLeadA: any;
  let teamLeadB: any;
  let teamLeadC: any;

  let employee1: any;
  let employee2: any;
  let employee3: any;
  let employeeOtherOrg: any;

  let teamA: any;
  let teamB: any;
  let teamC: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // 1. Create Organizations
    org1 = await Organization.create({
      name: "NexisparkX Org 1",
      slug: "nexisparkx-1",
      status: "ACTIVE",
    });

    org2 = await Organization.create({
      name: "Other Tenant Org 2",
      slug: "tenant-2",
      status: "ACTIVE",
    });

    // 2. Create Departments
    dept1 = await Department.create({
      organizationId: org1._id,
      name: "Engineering",
    });

    dept2 = await Department.create({
      organizationId: org2._id,
      name: "Marketing",
    });

    // 3. Create Super Admin & Admins
    superAdmin = await User.create({
      fullName: "Super Admin",
      email: "superadmin@test.com",
      passwordHash: "hash",
      role: "SUPER_ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: null,
    });

    adminOrg1 = await User.create({
      fullName: "Admin Org 1",
      email: "admin1@test.com",
      passwordHash: "hash",
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
    });

    adminOrg2 = await User.create({
      fullName: "Admin Org 2",
      email: "admin2@test.com",
      passwordHash: "hash",
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: org2._id,
    });

    // 4. Create Managers
    managerA = await User.create({
      fullName: "Manager A",
      email: "managerA@test.com",
      passwordHash: "hash",
      role: "MANAGER",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
    });

    managerB = await User.create({
      fullName: "Manager B",
      email: "managerB@test.com",
      passwordHash: "hash",
      role: "MANAGER",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
    });

    // 5. Create Team Leads
    teamLeadA = await User.create({
      fullName: "Team Lead A",
      email: "leadA@test.com",
      passwordHash: "hash",
      role: "TEAM_LEADER",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
      reportingManagerId: managerA._id,
    });

    teamLeadB = await User.create({
      fullName: "Team Lead B",
      email: "leadB@test.com",
      passwordHash: "hash",
      role: "TEAM_LEADER",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
      reportingManagerId: managerA._id,
    });

    teamLeadC = await User.create({
      fullName: "Team Lead C (Manager B)",
      email: "leadC@test.com",
      passwordHash: "hash",
      role: "TEAM_LEADER",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
      reportingManagerId: managerB._id,
    });

    // 6. Create Teams
    // Team A: Managed by Manager A, led by TeamLead A
    teamA = await Team.create({
      organizationId: org1._id,
      departmentId: dept1._id,
      name: "Team Frontend",
      managerId: managerA._id,
      teamLeadId: teamLeadA._id,
      status: "ACTIVE",
    });

    // Team B: Also Managed by Manager A, led by TeamLead B (One Manager -> Multiple Teams!)
    teamB = await Team.create({
      organizationId: org1._id,
      departmentId: dept1._id,
      name: "Team Backend",
      managerId: managerA._id,
      teamLeadId: teamLeadB._id,
      status: "ACTIVE",
    });

    // Team C: Managed by Manager B, led by TeamLead C
    teamC = await Team.create({
      organizationId: org1._id,
      departmentId: dept1._id,
      name: "Team DevOps",
      managerId: managerB._id,
      teamLeadId: teamLeadC._id,
      status: "ACTIVE",
    });

    // 7. Create Employees
    employee1 = await User.create({
      fullName: "Employee 1 (under Team A)",
      email: "emp1@test.com",
      passwordHash: "hash",
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
      teamId: String(teamA._id),
    });

    employee2 = await User.create({
      fullName: "Employee 2 (under Team B)",
      email: "emp2@test.com",
      passwordHash: "hash",
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
      teamId: String(teamB._id),
    });

    employee3 = await User.create({
      fullName: "Employee 3 (under Team C - Manager B)",
      email: "emp3@test.com",
      passwordHash: "hash",
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      organizationId: org1._id,
      departmentId: String(dept1._id),
      teamId: String(teamC._id),
    });

    employeeOtherOrg = await User.create({
      fullName: "Employee Other Org",
      email: "empOrg2@test.com",
      passwordHash: "hash",
      role: "EMPLOYEE",
      employmentType: "EMPLOYEE",
      organizationId: org2._id,
      departmentId: String(dept2._id),
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // TEST 1: Manager owns Team A and Team B. Expected: Manager sees Team A + Team B.
  it("TEST 1: Manager manages multiple teams (Team A and Team B)", async () => {
    const scope = await getManagementScope(managerA);
    expect(scope.isManager).toBe(true);
    expect(scope.managedTeamIds).toContain(String(teamA._id));
    expect(scope.managedTeamIds).toContain(String(teamB._id));
    expect(scope.managedTeamIds).not.toContain(String(teamC._id));
  });

  // TEST 2: Manager has Team Lead A and Team Lead B. Expected: Manager can see both.
  it("TEST 2: Manager scope includes both Team Lead A and Team Lead B", async () => {
    const scope = await getManagementScope(managerA);
    expect(scope.scopedUserIds).toContain(String(teamLeadA._id));
    expect(scope.scopedUserIds).toContain(String(teamLeadB._id));
    expect(scope.scopedUserIds).not.toContain(String(teamLeadC._id));
  });

  // TEST 3: Manager assigns task to Team Lead A. Expected: Allowed.
  it("TEST 3: Manager can assign task to Team Lead A", async () => {
    const allowed = await canUserAssignWorkTo(managerA, {
      targetUserId: String(teamLeadA._id),
      targetTeamId: String(teamA._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(managerA, {
        title: "Architecture Review",
        assignedTo: String(teamLeadA._id),
        teamId: String(teamA._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 4: Manager assigns task directly to employee under Team B. Expected: Allowed.
  it("TEST 4: Manager can assign task directly to Employee 2 under Team B", async () => {
    const allowed = await canUserAssignWorkTo(managerA, {
      targetUserId: String(employee2._id),
      targetTeamId: String(teamB._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(managerA, {
        title: "API Implementation",
        assignedTo: String(employee2._id),
        teamId: String(teamB._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 5: Manager attempts assignment to another Manager's employee. Expected: Blocked.
  it("TEST 5: Manager A attempting to assign task to Manager B's employee is Blocked", async () => {
    const allowed = await canUserAssignWorkTo(managerA, {
      targetUserId: String(employee3._id),
      targetTeamId: String(teamC._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(managerA, {
        title: "Unauthorized Task",
        assignedTo: String(employee3._id),
        teamId: String(teamC._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_OUTSIDE_SCOPE");
  });

  // TEST 6: Team Lead assigns task to own team employee. Expected: Allowed.
  it("TEST 6: Team Lead A can assign task to Employee 1 in Team A", async () => {
    const allowed = await canUserAssignWorkTo(teamLeadA, {
      targetUserId: String(employee1._id),
      targetTeamId: String(teamA._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(teamLeadA, {
        title: "Design Landing Page",
        assignedTo: String(employee1._id),
        teamId: String(teamA._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 7: Team Lead assigns task to another team's employee. Expected: Blocked.
  it("TEST 7: Team Lead A attempting to assign task to Employee 2 (Team B) is Blocked", async () => {
    const allowed = await canUserAssignWorkTo(teamLeadA, {
      targetUserId: String(employee2._id),
      targetTeamId: String(teamB._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(teamLeadA, {
        title: "Cross Team Task",
        assignedTo: String(employee2._id),
        teamId: String(teamB._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_OUTSIDE_SCOPE");
  });

  // TEST 8: Admin assigns task directly to employee. Expected: Allowed.
  it("TEST 8: Admin can directly assign task to any employee in organization", async () => {
    const allowed = await canUserAssignWorkTo(adminOrg1, {
      targetUserId: String(employee1._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(adminOrg1, {
        title: "Company-wide Audit",
        assignedTo: String(employee1._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 9: Admin assigns task directly to Manager. Expected: Allowed.
  it("TEST 9: Admin can directly assign task to Manager A", async () => {
    const allowed = await canUserAssignWorkTo(adminOrg1, {
      targetUserId: String(managerA._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(adminOrg1, {
        title: "Quarterly Planning",
        assignedTo: String(managerA._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 10: Admin assigns task directly to Team Lead. Expected: Allowed.
  it("TEST 10: Admin can directly assign task to Team Lead B", async () => {
    const allowed = await canUserAssignWorkTo(adminOrg1, {
      targetUserId: String(teamLeadB._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(adminOrg1, {
        title: "Sprint Review",
        assignedTo: String(teamLeadB._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 11: Super Admin assigns work to any permitted user. Expected: Allowed.
  it("TEST 11: Super Admin can assign work to any user system-wide", async () => {
    const allowed = await canUserAssignWorkTo(superAdmin, {
      targetUserId: String(employeeOtherOrg._id),
    });
    expect(allowed).toBe(true);

    await expect(
      validateTaskAssignment(superAdmin, {
        title: "Global Platform Migration",
        assignedTo: String(employeeOtherOrg._id),
      })
    ).resolves.not.toThrow();
  });

  // TEST 12: Admin attempts access to another organization. Expected: Blocked.
  it("TEST 12: Admin Org 1 attempting to assign task to Employee in Org 2 is Blocked", async () => {
    const allowed = await canUserAssignWorkTo(adminOrg1, {
      targetUserId: String(employeeOtherOrg._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(adminOrg1, {
        title: "Cross-Tenant Attack",
        assignedTo: String(employeeOtherOrg._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_OUTSIDE_SCOPE");
  });

  // TEST 13: Manager attempts access to another organization's team. Expected: Blocked.
  it("TEST 13: Manager A attempting to assign task in Org 2 is Blocked", async () => {
    const allowed = await canUserAssignWorkTo(managerA, {
      targetUserId: String(employeeOtherOrg._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(managerA, {
        title: "Cross Org Assignment",
        assignedTo: String(employeeOtherOrg._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_OUTSIDE_SCOPE");
  });

  // TEST 14: Employee attempts to access Manager/team management APIs. Expected: Blocked.
  it("TEST 14: Employee 1 attempting to assign work to Employee 2 is Blocked", async () => {
    const allowed = await canUserAssignWorkTo(employee1, {
      targetUserId: String(employee2._id),
    });
    expect(allowed).toBe(false);

    await expect(
      validateTaskAssignment(employee1, {
        title: "Unauthorized Delegation",
        assignedTo: String(employee2._id),
      })
    ).rejects.toThrow("CANNOT_ASSIGN_TO_OTHERS");
  });
});
