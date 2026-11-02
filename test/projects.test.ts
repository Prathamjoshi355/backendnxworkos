import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Project from "../src/models/Project";
import Task from "../src/models/Task";
import User from "../src/models/User";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import * as projectService from "../src/services/projectService";
import * as taskService from "../src/services/taskService";

describe("Projects & Project Management End-to-End Integration Tests", () => {
  let mongoServer: MongoMemoryServer;
  let testOrgId: mongoose.Types.ObjectId;
  let otherOrgId: mongoose.Types.ObjectId;
  let deptId: mongoose.Types.ObjectId;
  let teamId: mongoose.Types.ObjectId;
  let adminUser: any;
  let managerUser: any;
  let employeeUser1: any;
  let employeeUser2: any;
  let otherOrgUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Create Main Org
    const org = await Organization.create({
      name: "Project Test Org",
      slug: "project-test-org",
      status: "ACTIVE",
    });
    testOrgId = org._id as mongoose.Types.ObjectId;

    // Create Other Org
    const otherOrg = await Organization.create({
      name: "Other Org",
      slug: "other-org",
      status: "ACTIVE",
    });
    otherOrgId = otherOrg._id as mongoose.Types.ObjectId;

    // Create Department
    const dept = await Department.create({
      name: "Engineering",
      code: "ENG",
      organizationId: testOrgId,
    });
    deptId = dept._id as mongoose.Types.ObjectId;

    // Create Team
    const team = await Team.create({
      name: "Core Platform",
      code: "CORE",
      organizationId: testOrgId,
      departmentId: deptId,
    });
    teamId = team._id as mongoose.Types.ObjectId;

    // Create Admin User
    adminUser = await User.create({
      fullName: "Org Admin",
      email: "admin@test.com",
      employeeId: "ADM001",
      role: "ADMIN",
      organizationId: testOrgId,
      departmentId: deptId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create Manager User
    managerUser = await User.create({
      fullName: "Engineering Manager",
      email: "manager@test.com",
      employeeId: "MGR001",
      role: "MANAGER",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create Employee 1
    employeeUser1 = await User.create({
      fullName: "Alice Developer",
      email: "alice@test.com",
      employeeId: "EMP001",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create Employee 2
    employeeUser2 = await User.create({
      fullName: "Bob Designer",
      email: "bob@test.com",
      employeeId: "EMP002",
      role: "EMPLOYEE",
      organizationId: testOrgId,
      departmentId: deptId,
      teamId: teamId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });

    // Create Other Org Employee
    otherOrgUser = await User.create({
      fullName: "Other Employee",
      email: "other@other.com",
      employeeId: "OTH001",
      role: "EMPLOYEE",
      organizationId: otherOrgId,
      status: "ACTIVE",
      passwordHash: "hashed-pw-123",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("1. Project Creation & Initialization", () => {
    it("should successfully create a project with auto-generated code and include creator in members", async () => {
      const payload = {
        name: "Mobile App Redesign",
        description: "Complete redesign of the mobile application",
        priority: "HIGH",
        status: "ACTIVE",
        departmentId: deptId,
        teamId: teamId,
        members: [employeeUser1._id.toString()],
      };

      const project = await projectService.createProject(managerUser, payload);

      expect(project).toBeDefined();
      expect(project.name).toBe("Mobile App Redesign");
      expect(project.code).toMatch(/^[A-Z0-9]+-\d+$/);
      expect(project.projectId).toMatch(/^PRJ-\d{4}$/);
      expect(project.status).toBe("ACTIVE");
      expect(project.priority).toBe("HIGH");
      expect(project.organizationId.toString()).toBe(testOrgId.toString());

      // Creator/owner and employee1 should both be members
      const memberStrings = project.members.map((m: any) => m.toString());
      expect(memberStrings).toContain(managerUser._id.toString());
      expect(memberStrings).toContain(employeeUser1._id.toString());
    });

    it("should require organization context on project creation", async () => {
      const invalidUser = { role: "ADMIN" };
      await expect(
        projectService.createProject(invalidUser, { name: "Invalid Project" })
      ).rejects.toThrow("ORGANIZATION_ID_REQUIRED");
    });
  });

  describe("2. Project Listing & Scoping (RBAC & Isolation)", () => {
    let projectAlpha: any;
    let projectBeta: any;

    beforeAll(async () => {
      projectAlpha = await projectService.createProject(managerUser, {
        name: "Project Alpha",
        code: "ALPHA-001",
        members: [employeeUser1._id.toString()],
      });

      projectBeta = await projectService.createProject(adminUser, {
        name: "Project Beta",
        code: "BETA-002",
        members: [employeeUser2._id.toString()],
      });
    });

    it("Admin / Manager should see all projects within the organization", async () => {
      const result = await projectService.listProjects(adminUser);
      expect(result.total).toBeGreaterThanOrEqual(2);
      const names = result.items.map((p) => p.name);
      expect(names).toContain("Project Alpha");
      expect(names).toContain("Project Beta");
    });

    it("Employee 1 should only see projects where they are assigned as a member", async () => {
      const result = await projectService.listProjects(employeeUser1);
      const names = result.items.map((p) => p.name);
      expect(names).toContain("Project Alpha");
      expect(names).not.toContain("Project Beta");
    });

    it("Employee from another organization should see 0 projects from test org", async () => {
      const result = await projectService.listProjects(otherOrgUser);
      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe("3. Project ↔ Task Integration & Dynamic Progress Calculation", () => {
    let testProject: any;

    beforeAll(async () => {
      testProject = await projectService.createProject(managerUser, {
        name: "E-Commerce Microservices",
        code: "ECOM-100",
        members: [employeeUser1._id.toString()],
      });
    });

    it("should initially calculate 0% progress when project has no tasks", async () => {
      const fetched = await projectService.getProjectById(testProject._id.toString(), managerUser);
      expect(fetched.totalTasks).toBe(0);
      expect(fetched.completedTasks).toBe(0);
      expect(fetched.progress).toBe(0);
    });

    it("should dynamically recalculate progress as tasks are created and completed", async () => {
      // Create 2 tasks linked to the project
      const task1 = await taskService.createTask({
        title: "Database Schema Migration",
        assignedTo: employeeUser1._id.toString(),
        assignedBy: managerUser._id.toString(),
        organizationId: testOrgId.toString(),
        projectId: testProject._id.toString(),
        status: "IN_PROGRESS",
      });

      const task2 = await taskService.createTask({
        title: "API Gateway Routes",
        assignedTo: employeeUser1._id.toString(),
        assignedBy: managerUser._id.toString(),
        organizationId: testOrgId.toString(),
        projectId: testProject._id.toString(),
        status: "ASSIGNED",
      });

      // Verify 0% (0/2 completed)
      let fetched = await projectService.getProjectById(testProject._id.toString(), managerUser);
      expect(fetched.totalTasks).toBe(2);
      expect(fetched.completedTasks).toBe(0);
      expect(fetched.progress).toBe(0);

      // Complete Task 1
      await Task.findByIdAndUpdate(task1._id, { status: "COMPLETED" });

      // Verify 50% (1/2 completed)
      fetched = await projectService.getProjectById(testProject._id.toString(), managerUser);
      expect(fetched.totalTasks).toBe(2);
      expect(fetched.completedTasks).toBe(1);
      expect(fetched.progress).toBe(50);

      // Complete Task 2
      await Task.findByIdAndUpdate(task2._id, { status: "COMPLETED" });

      // Verify 100% (2/2 completed)
      fetched = await projectService.getProjectById(testProject._id.toString(), managerUser);
      expect(fetched.totalTasks).toBe(2);
      expect(fetched.completedTasks).toBe(2);
      expect(fetched.progress).toBe(100);

      // Retrieve project tasks list
      const tasks = await projectService.getProjectTasks(testProject._id.toString(), managerUser);
      expect(tasks.length).toBe(2);
      expect(tasks[0].title).toBeDefined();
      expect(tasks[0].assignedTo).toBeDefined();
    });
  });

  describe("4. Project Updates, Member Management & Archiving", () => {
    let updateProjectDoc: any;

    beforeAll(async () => {
      updateProjectDoc = await projectService.createProject(managerUser, {
        name: "Security Audit Project",
        code: "SEC-001",
        priority: "MEDIUM",
        members: [employeeUser1._id.toString()],
      });
    });

    it("should allow manager to update project details and status", async () => {
      const updated = await projectService.updateProject(
        updateProjectDoc._id.toString(),
        managerUser,
        {
          priority: "URGENT",
          status: "ON_HOLD",
          description: "Pending external vendor audit report",
        }
      );

      expect(updated.priority).toBe("URGENT");
      expect(updated.status).toBe("ON_HOLD");
      expect(updated.description).toBe("Pending external vendor audit report");
    });

    it("should allow adding new members to the project without duplicates", async () => {
      const updated = await projectService.addProjectMembers(
        updateProjectDoc._id.toString(),
        [employeeUser2._id.toString(), employeeUser1._id.toString()],
        managerUser
      );

      const memberIds = updated.members.map((m: any) => m.toString());
      expect(memberIds).toContain(employeeUser2._id.toString());
      expect(memberIds.filter((id: string) => id === employeeUser1._id.toString()).length).toBe(1);
    });

    it("should allow removing a member from the project", async () => {
      const updated = await projectService.removeProjectMember(
        updateProjectDoc._id.toString(),
        employeeUser2._id.toString(),
        managerUser
      );

      const memberIds = updated.members.map((m: any) => m.toString());
      expect(memberIds).not.toContain(employeeUser2._id.toString());
    });

    it("should prevent cross-organization users from accessing or modifying the project", async () => {
      await expect(
        projectService.getProjectById(updateProjectDoc._id.toString(), otherOrgUser)
      ).rejects.toThrow("FORBIDDEN");

      await expect(
        projectService.updateProject(updateProjectDoc._id.toString(), otherOrgUser, { name: "Hacked" })
      ).rejects.toThrow("FORBIDDEN");

      await expect(
        projectService.archiveProject(updateProjectDoc._id.toString(), otherOrgUser)
      ).rejects.toThrow("FORBIDDEN");
    });

    it("should archive / cancel a project successfully", async () => {
      const archived = await projectService.archiveProject(
        updateProjectDoc._id.toString(),
        adminUser
      );

      expect(archived.status).toBe("CANCELLED");
    });
  });
});
