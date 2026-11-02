import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Organization from "../src/models/Organization";
import Division from "../src/models/Division";
import Department from "../src/models/Department";
import Team from "../src/models/Team";
import User from "../src/models/User";
import Project from "../src/models/Project";
import Task from "../src/models/Task";
import FileRecord from "../src/models/FileRecord";
import Compensation from "../src/models/Compensation";
import {
  validateOrganizationDivision,
  validateOrganizationDepartmentTeam,
  validateDivisionDepartmentTeam,
  validateUserHierarchy,
  validateProjectTaskHierarchy,
  validatePersistedHierarchy,
  HierarchyValidationError,
} from "../src/services/hierarchyValidator";
import {
  createDivision,
  getDivisionById,
  listDivisions,
  updateDivision,
  archiveDivision,
  deactivateDivision,
  validateDivisionHead,
  checkDivisionNameUnique,
  checkDivisionCodeUnique,
  getDivisionDependentCounts,
} from "../src/services/divisionService";
import {
  hasDivisionAccess,
  validateDivisionScope,
  validateRoleAssignment,
  DivisionAuthError,
} from "../src/utils/divisionAuth";

describe("Phase 2: NXWorkOS Division Architecture - Validation, Service & Authorization", () => {
  let mongoServer: MongoMemoryServer;

  let orgAId: mongoose.Types.ObjectId;
  let orgBId: mongoose.Types.ObjectId;
  let orgCInactiveId: mongoose.Types.ObjectId;

  let superAdminUser: any;
  let adminOrgA: any;
  let adminOrgB: any;
  let hrOrgA: any;
  let managerOrgA: any;
  let employeeOrgA: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    orgAId = new mongoose.Types.ObjectId();
    orgBId = new mongoose.Types.ObjectId();
    orgCInactiveId = new mongoose.Types.ObjectId();

    await Organization.create([
      {
        _id: orgAId,
        name: "NexisparkX Primary Tenant",
        legalName: "NexisparkX Private Limited",
        status: "ACTIVE",
      },
      {
        _id: orgBId,
        name: "Secondary Tenant Org",
        legalName: "Secondary Tenant Corp",
        status: "ACTIVE",
      },
      {
        _id: orgCInactiveId,
        name: "Suspended Tenant Org",
        legalName: "Suspended Tenant Corp",
        status: "INACTIVE",
      },
    ]);

    // Create baseline test users
    superAdminUser = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Platform Super Admin",
      email: "superadmin@nxworkos.test",
      role: "SUPER_ADMIN",
      organizationId: orgAId,
      status: "ACTIVE",
    };

    adminOrgA = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Org A Admin",
      email: "admin_a@nxworkos.test",
      role: "ADMIN",
      organizationId: orgAId,
      status: "ACTIVE",
    };

    adminOrgB = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Org B Admin",
      email: "admin_b@nxworkos.test",
      role: "ADMIN",
      organizationId: orgBId,
      status: "ACTIVE",
    };

    hrOrgA = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "HR Specialist A",
      email: "hr_a@nxworkos.test",
      role: "HR",
      organizationId: orgAId,
      status: "ACTIVE",
      permissions: ["hr.manage"],
    };

    managerOrgA = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Manager A",
      email: "manager_a@nxworkos.test",
      role: "MANAGER",
      organizationId: orgAId,
      status: "ACTIVE",
    };

    employeeOrgA = {
      _id: new mongoose.Types.ObjectId(),
      fullName: "Employee A",
      email: "emp_a@nxworkos.test",
      role: "EMPLOYEE",
      organizationId: orgAId,
      status: "ACTIVE",
    };
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await Division.deleteMany({});
    await Department.deleteMany({});
    await Team.deleteMany({});
    await Project.deleteMany({});
    await Task.deleteMany({});
    await User.deleteMany({ _id: { $nin: [superAdminUser._id, adminOrgA._id, adminOrgB._id] } });
  });

  // =========================================================================
  // 1. HIERARCHY VALIDATOR TESTS
  // =========================================================================
  describe("1. Hierarchy Validator (backend/src/services/hierarchyValidator.ts)", () => {
    describe("Organization → Division Relationship", () => {
      it("validates a compliant, active organization-division pair", async () => {
        const div = await Division.create({
          organizationId: orgAId,
          name: "Technology Division",
          code: "TECH",
          status: "ACTIVE",
        });

        const result = await validateOrganizationDivision({
          organizationId: orgAId,
          divisionId: div._id,
        });

        expect(result.organization).toBeDefined();
        expect(result.division).toBeDefined();
        expect(String(result.division._id)).toBe(String(div._id));
      });

      it("rejects cross-tenant organization-division references", async () => {
        const div = await Division.create({
          organizationId: orgAId,
          name: "Org A Division",
          code: "OADIV",
          status: "ACTIVE",
        });

        // Attempt validating with Org B
        await expect(
          validateOrganizationDivision({
            organizationId: orgBId,
            divisionId: div._id,
          })
        ).rejects.toThrow(/CROSS_TENANT_REFERENCE/);
      });

      it("rejects inactive parent organization when active parent is required", async () => {
        const div = await Division.create({
          organizationId: orgCInactiveId,
          name: "Suspended Division",
          code: "SUSP",
          status: "ACTIVE",
        });

        await expect(
          validateOrganizationDivision({
            organizationId: orgCInactiveId,
            divisionId: div._id,
            requireActive: true,
          })
        ).rejects.toThrow(/INACTIVE_PARENT_ORGANIZATION/);
      });

      it("rejects inactive division when active is required", async () => {
        const div = await Division.create({
          organizationId: orgAId,
          name: "Archived Division",
          code: "ARCH1",
          status: "ARCHIVED",
        });

        await expect(
          validateOrganizationDivision({
            organizationId: orgAId,
            divisionId: div._id,
            requireActive: true,
          })
        ).rejects.toThrow(/INACTIVE_DIVISION/);
      });
    });

    describe("Organization → Department → Team Relationship", () => {
      it("validates a consistent Organization → Department → Team hierarchy", async () => {
        const dept = await Department.create({
          organizationId: orgAId,
          name: "Engineering",
          status: "ACTIVE",
        });

        const team = await Team.create({
          organizationId: orgAId,
          departmentId: dept._id,
          name: "Frontend Core",
          status: "ACTIVE",
        });

        const result = await validateOrganizationDepartmentTeam({
          organizationId: orgAId,
          departmentId: dept._id,
          teamId: team._id,
        });

        expect(result.department).toBeDefined();
        expect(result.team).toBeDefined();
      });

      it("rejects cross-tenant department reference", async () => {
        const deptInOrgB = await Department.create({
          organizationId: orgBId,
          name: "Finance Org B",
          status: "ACTIVE",
        });

        await expect(
          validateOrganizationDepartmentTeam({
            organizationId: orgAId,
            departmentId: deptInOrgB._id,
          })
        ).rejects.toThrow(/CROSS_TENANT_REFERENCE/);
      });

      it("rejects team whose department does not match the parent department (HIERARCHY_MISMATCH)", async () => {
        const dept1 = await Department.create({
          organizationId: orgAId,
          name: "Dept One",
          status: "ACTIVE",
        });
        const dept2 = await Department.create({
          organizationId: orgAId,
          name: "Dept Two",
          status: "ACTIVE",
        });

        const teamUnderDept2 = await Team.create({
          organizationId: orgAId,
          departmentId: dept2._id,
          name: "Team of Dept 2",
          status: "ACTIVE",
        });

        // Attempt validating teamUnderDept2 against dept1
        await expect(
          validateOrganizationDepartmentTeam({
            organizationId: orgAId,
            departmentId: dept1._id,
            teamId: teamUnderDept2._id,
          })
        ).rejects.toThrow(/HIERARCHY_MISMATCH/);
      });

      it("rejects inactive parent department when requireActive is true", async () => {
        const dept = await Department.create({
          organizationId: orgAId,
          name: "Deactivated Dept",
          status: "INACTIVE",
        });

        await expect(
          validateOrganizationDepartmentTeam({
            organizationId: orgAId,
            departmentId: dept._id,
            requireActive: true,
          })
        ).rejects.toThrow(/INACTIVE_PARENT_DEPARTMENT/);
      });
    });

    describe("Division → Department → Team Relationship", () => {
      let div1: any;
      let div2: any;

      beforeEach(async () => {
        div1 = await Division.create({
          organizationId: orgAId,
          name: "Technology Division",
          code: "TECH",
          status: "ACTIVE",
        });
        div2 = await Division.create({
          organizationId: orgAId,
          name: "Education Division",
          code: "EDU",
          status: "ACTIVE",
        });
      });

      it("validates compliant divisional department and team", async () => {
        const dept = await Department.create({
          organizationId: orgAId,
          divisionId: div1._id,
          name: "Software Dev",
          status: "ACTIVE",
        });

        const team = await Team.create({
          organizationId: orgAId,
          departmentId: dept._id,
          divisionId: div1._id,
          name: "Platform Squad",
          status: "ACTIVE",
        });

        const result = await validateDivisionDepartmentTeam({
          organizationId: orgAId,
          divisionId: div1._id,
          departmentId: dept._id,
          teamId: team._id,
        });

        expect(result.division).toBeDefined();
        expect(result.department).toBeDefined();
        expect(result.team).toBeDefined();
      });

      it("rejects assigning or evaluating Central Headquarters department as part of an operational division", async () => {
        const centralDept = await Department.create({
          organizationId: orgAId,
          isCentral: true,
          divisionId: null,
          name: "Central Human Resources",
          status: "ACTIVE",
        });

        await expect(
          validateDivisionDepartmentTeam({
            organizationId: orgAId,
            divisionId: div1._id,
            departmentId: centralDept._id,
          })
        ).rejects.toThrow(/CENTRAL_DEPARTMENT_DIVISION_PROHIBITED/);
      });

      it("rejects department whose division does not match expected division (DIVISION_MISMATCH)", async () => {
        const deptInDiv2 = await Department.create({
          organizationId: orgAId,
          divisionId: div2._id,
          name: "Curriculum Design",
          status: "ACTIVE",
        });

        await expect(
          validateDivisionDepartmentTeam({
            organizationId: orgAId,
            divisionId: div1._id,
            departmentId: deptInDiv2._id,
          })
        ).rejects.toThrow(/DIVISION_MISMATCH/);
      });

      it("rejects unclassified department with null divisionId when division assignment is validated", async () => {
        // Missing or null divisionId must never grant broader access or classify as Headquarters
        const unclassifiedDept = await Department.create({
          organizationId: orgAId,
          divisionId: null,
          isCentral: false,
          name: "Legacy Dept Unclassified",
          status: "ACTIVE",
        });

        await expect(
          validateDivisionDepartmentTeam({
            organizationId: orgAId,
            divisionId: div1._id,
            departmentId: unclassifiedDept._id,
          })
        ).rejects.toThrow(/UNCLASSIFIED_DEPARTMENT_DIVISION_MISMATCH/);
      });

      it("rejects team whose divisionId conflicts with parent department divisionId", async () => {
        const dept = await Department.create({
          organizationId: orgAId,
          divisionId: div1._id,
          name: "Software Dev",
          status: "ACTIVE",
        });

        const conflictingTeam = await Team.create({
          organizationId: orgAId,
          departmentId: dept._id,
          divisionId: div2._id, // Team in Div 2 under Dept in Div 1
          name: "Conflicted Squad",
          status: "ACTIVE",
        });

        await expect(
          validateDivisionDepartmentTeam({
            organizationId: orgAId,
            divisionId: div1._id,
            departmentId: dept._id,
            teamId: conflictingTeam._id,
          })
        ).rejects.toThrow(/HIERARCHY_MISMATCH/);
      });
    });

    describe("Organization/Division → User Relationship", () => {
      let div: any;

      beforeEach(async () => {
        div = await Division.create({
          organizationId: orgAId,
          name: "Operations Division",
          code: "OPS",
          status: "ACTIVE",
        });
      });

      it("validates a user with consistent organization, division, department, and team", async () => {
        const dept = await Department.create({
          organizationId: orgAId,
          divisionId: div._id,
          name: "Logistics",
          status: "ACTIVE",
        });

        const team = await Team.create({
          organizationId: orgAId,
          departmentId: dept._id,
          divisionId: div._id,
          name: "Fleet",
          status: "ACTIVE",
        });

        const result = await validateUserHierarchy({
          organizationId: orgAId,
          divisionId: div._id,
          departmentId: dept._id,
          teamId: team._id,
        });

        expect(result.organization).toBeDefined();
        expect(result.division).toBeDefined();
        expect(result.department).toBeDefined();
        expect(result.team).toBeDefined();
      });

      it("preserves compatibility with legacy string-based User.departmentId and User.teamId", async () => {
        // Must NOT throw CastError for legacy string identifiers
        const result = await validateUserHierarchy({
          organizationId: orgAId,
          divisionId: div._id,
          departmentId: "legacy-string-dept-42",
          teamId: "legacy-string-team-99",
        });

        expect(result.organization).toBeDefined();
        expect(result.division).toBeDefined();
      });

      it("rejects cross-tenant department assignment on user", async () => {
        const deptOrgB = await Department.create({
          organizationId: orgBId,
          name: "Foreign Dept",
          status: "ACTIVE",
        });

        await expect(
          validateUserHierarchy({
            organizationId: orgAId,
            divisionId: div._id,
            departmentId: deptOrgB._id,
          })
        ).rejects.toThrow(/CROSS_TENANT_REFERENCE/);
      });

      it("rejects placing a user with missing divisionId into a divisional department", async () => {
        const dept = await Department.create({
          organizationId: orgAId,
          divisionId: div._id,
          name: "Specialized Divisional Dept",
          status: "ACTIVE",
        });

        // Missing divisionId must never grant broader access or auto-classify
        await expect(
          validateUserHierarchy({
            organizationId: orgAId,
            divisionId: null,
            departmentId: dept._id,
          })
        ).rejects.toThrow(/INVALID_DIVISION_ASSIGNMENT/);
      });

      it("rejects inactive parent division for active user assignment", async () => {
        const inactiveDiv = await Division.create({
          organizationId: orgAId,
          name: "Disbanded Division",
          code: "DISB",
          status: "INACTIVE",
        });

        await expect(
          validateUserHierarchy({
            organizationId: orgAId,
            divisionId: inactiveDiv._id,
            requireActiveParents: true,
          })
        ).rejects.toThrow(/INACTIVE_PARENT_DIVISION/);
      });
    });

    describe("Organization/Division → Project → Task Relationship", () => {
      let divA: any;
      let divB: any;

      beforeEach(async () => {
        divA = await Division.create({
          organizationId: orgAId,
          name: "Design Division",
          code: "DES",
          status: "ACTIVE",
        });
        divB = await Division.create({
          organizationId: orgAId,
          name: "Media Division",
          code: "MEDIA",
          status: "ACTIVE",
        });
      });

      it("validates single-division project and aligned task", async () => {
        const project = await Project.create({
          projectId: "PRJ-DES-001",
          organizationId: orgAId,
          divisionId: divA._id,
          name: "Brand Redesign",
          code: "BR-01",
          ownerId: adminOrgA._id,
          createdBy: adminOrgA._id,
        });

        const task = await Task.create({
          taskId: "TSK-DES-101",
          title: "Design System Guidelines",
          organizationId: orgAId,
          divisionId: divA._id,
          projectId: project._id,
          assignedTo: adminOrgA._id,
          assignedBy: adminOrgA._id,
        });

        const result = await validateProjectTaskHierarchy({
          organizationId: orgAId,
          divisionId: divA._id,
          projectId: project._id,
          taskId: task._id,
        });

        expect(result.project).toBeDefined();
        expect(result.task).toBeDefined();
      });

      it("validates cross-division project with collaborating division task", async () => {
        const crossProject = await Project.create({
          projectId: "PRJ-CROSS-001",
          organizationId: orgAId,
          divisionId: divA._id,
          isCrossDivision: true,
          collaboratingDivisionIds: [divB._id],
          name: "Omnichannel Campaign",
          code: "OC-01",
          ownerId: adminOrgA._id,
          createdBy: adminOrgA._id,
        });

        // Task created under collaborating division B
        const taskInDivB = await Task.create({
          taskId: "TSK-COL-201",
          title: "Video Asset Production",
          organizationId: orgAId,
          divisionId: divB._id,
          projectId: crossProject._id,
          assignedTo: adminOrgA._id,
          assignedBy: adminOrgA._id,
        });

        const result = await validateProjectTaskHierarchy({
          organizationId: orgAId,
          projectId: crossProject._id,
          taskId: taskInDivB._id,
        });

        expect(result.project).toBeDefined();
        expect(result.task).toBeDefined();
      });

      it("rejects task whose division does not align with project primary or collaborating divisions", async () => {
        const nonCollabDiv = await Division.create({
          organizationId: orgAId,
          name: "Unrelated Division",
          code: "UNREL",
          status: "ACTIVE",
        });

        const project = await Project.create({
          projectId: "PRJ-DES-002",
          organizationId: orgAId,
          divisionId: divA._id,
          isCrossDivision: false,
          name: "Internal Brand Book",
          code: "IBB-01",
          ownerId: adminOrgA._id,
          createdBy: adminOrgA._id,
        });

        const rogueTask = await Task.create({
          taskId: "TSK-ROGUE-001",
          title: "Unrelated Task",
          organizationId: orgAId,
          divisionId: nonCollabDiv._id,
          projectId: project._id,
          assignedTo: adminOrgA._id,
          assignedBy: adminOrgA._id,
        });

        await expect(
          validateProjectTaskHierarchy({
            organizationId: orgAId,
            projectId: project._id,
            taskId: rogueTask._id,
          })
        ).rejects.toThrow(/TASK_PROJECT_DIVISION_MISMATCH/);
      });

      it("rejects cross-tenant task assignment", async () => {
        const taskOrgB = await Task.create({
          taskId: "TSK-FOREIGN-01",
          title: "Foreign Task",
          organizationId: orgBId,
          assignedTo: adminOrgB._id,
          assignedBy: adminOrgB._id,
        });

        await expect(
          validateProjectTaskHierarchy({
            organizationId: orgAId,
            taskId: taskOrgB._id,
          })
        ).rejects.toThrow(/CROSS_TENANT_REFERENCE/);
      });
    });

    describe("Persisted Hierarchy Verification (validatePersistedHierarchy)", () => {
      it("validates stored DIVISION, DEPARTMENT, TEAM directly from MongoDB", async () => {
        const div = await Division.create({
          organizationId: orgAId,
          name: "R&D Division",
          code: "RND",
          status: "ACTIVE",
        });

        const dept = await Department.create({
          organizationId: orgAId,
          divisionId: div._id,
          name: "AI Lab",
          status: "ACTIVE",
        });

        const team = await Team.create({
          organizationId: orgAId,
          departmentId: dept._id,
          divisionId: div._id,
          name: "NLP Team",
          status: "ACTIVE",
        });

        const resDiv = await validatePersistedHierarchy("DIVISION", div._id);
        const resDept = await validatePersistedHierarchy("DEPARTMENT", dept._id);
        const resTeam = await validatePersistedHierarchy("TEAM", team._id);

        expect(resDiv.division).toBeDefined();
        expect(resDept.department).toBeDefined();
        expect(resTeam.team).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 2. DIVISION SERVICE TESTS
  // =========================================================================
  describe("2. Division Service (backend/src/services/divisionService.ts)", () => {
    describe("createDivision", () => {
      it("creates a division deriving organization scope from authenticated identity", async () => {
        const created = await createDivision(adminOrgA, {
          organizationId: "ignored-client-id", // Must be overridden by server-side identity
          name: "Logistics Division",
          code: "LOGIS",
          description: "Supply chain and fleet management",
        });

        expect(created._id).toBeDefined();
        expect(String(created.organizationId)).toBe(String(orgAId));
        expect(created.name).toBe("Logistics Division");
        expect(created.code).toBe("LOGIS");
        expect(created.status).toBe("ACTIVE");
      });

      it("rejects unauthorized non-administrative roles (e.g. EMPLOYEE, MANAGER, HR)", async () => {
        await expect(
          createDivision(employeeOrgA, {
            name: "Employee Division",
            code: "EMPDIV",
          })
        ).rejects.toThrow(/FORBIDDEN/);

        await expect(
          createDivision(managerOrgA, {
            name: "Manager Division",
            code: "MGRDIV",
          })
        ).rejects.toThrow(/FORBIDDEN/);

        await expect(
          createDivision(hrOrgA, {
            name: "HR Division",
            code: "HRDIV",
          })
        ).rejects.toThrow(/FORBIDDEN/);
      });

      it("rejects reserved corporate entity identity 'NX Media' at the service layer", async () => {
        const reservedVariants = [
          "NX Media",
          "nx media",
          "NXMedia",
          "NX-Media",
          "nx_media",
          "NexisparkX Media",
          "NX Media Division",
        ];

        for (const name of reservedVariants) {
          await expect(
            createDivision(adminOrgA, {
              name,
              code: "NXM",
            })
          ).rejects.toThrow(/RESERVED_DIVISION_NAME_PROHIBITED/);
        }
      });

      it("rejects invalid division codes failing ^[A-Z0-9]{2,6}$ format", async () => {
        const invalidCodes = ["A", "TOOLONGCODE", "lower", "SP ACE", "HY-PH"];
        for (const code of invalidCodes) {
          await expect(
            createDivision(adminOrgA, {
              name: "Code Test Div " + code,
              code,
            })
          ).rejects.toThrow(/INVALID_DIVISION_CODE/);
        }
      });

      it("enforces organization-scoped name uniqueness", async () => {
        await createDivision(adminOrgA, {
          name: "Unique Div Name",
          code: "UNIQ1",
        });

        await expect(
          createDivision(adminOrgA, {
            name: "Unique Div Name",
            code: "UNIQ2",
          })
        ).rejects.toThrow(/DIVISION_NAME_EXISTS/);
      });

      it("enforces organization-scoped code uniqueness", async () => {
        await createDivision(adminOrgA, {
          name: "Div A",
          code: "SAMECD",
        });

        await expect(
          createDivision(adminOrgA, {
            name: "Div B",
            code: "SAMECD",
          })
        ).rejects.toThrow(/DIVISION_CODE_EXISTS/);
      });

      it("allows identical code and name in different organizations (tenant isolation)", async () => {
        const divOrgA = await createDivision(adminOrgA, {
          name: "Shared Name Division",
          code: "SHARED",
        });

        const divOrgB = await createDivision(adminOrgB, {
          name: "Shared Name Division",
          code: "SHARED",
        });

        expect(divOrgA._id).toBeDefined();
        expect(divOrgB._id).toBeDefined();
        expect(String(divOrgA.organizationId)).not.toBe(String(divOrgB.organizationId));
      });
    });

    describe("validateDivisionHead", () => {
      it("accepts an active employee within the same organization", async () => {
        const headUser = await User.create({
          fullName: "Division Head Candidate",
          email: `div_head_${Date.now()}@nxworkos.test`,
          passwordHash: "secret",
          role: "MANAGER",
          employmentType: "EMPLOYEE",
          organizationId: orgAId,
          status: "ACTIVE",
        });

        const isValid = await validateDivisionHead(orgAId, headUser._id);
        expect(isValid).toBe(true);
      });

      it("rejects cross-tenant division head assignment", async () => {
        const foreignUser = await User.create({
          fullName: "Foreign Tenant User",
          email: `foreign_head_${Date.now()}@nxworkos.test`,
          passwordHash: "secret",
          role: "MANAGER",
          employmentType: "EMPLOYEE",
          organizationId: orgBId,
          status: "ACTIVE",
        });

        await expect(
          validateDivisionHead(orgAId, foreignUser._id)
        ).rejects.toThrow(/CROSS_TENANT_REFERENCE/);
      });

      it("rejects inactive, suspended, or terminated user as division head", async () => {
        const suspendedUser = await User.create({
          fullName: "Suspended User",
          email: `suspended_${Date.now()}@nxworkos.test`,
          passwordHash: "secret",
          role: "EMPLOYEE",
          employmentType: "EMPLOYEE",
          organizationId: orgAId,
          status: "SUSPENDED",
        });

        await expect(
          validateDivisionHead(orgAId, suspendedUser._id)
        ).rejects.toThrow(/INACTIVE_USER/);
      });
    });

    describe("updateDivision", () => {
      it("updates permitted fields (name, description, budgetCode)", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Initial Name",
          code: "INIT",
          description: "Initial description",
        });

        const updated = await updateDivision(adminOrgA, div._id, {
          name: "Updated Name",
          description: "Updated description",
          budgetCode: "BG-2026-X",
        });

        expect(updated.name).toBe("Updated Name");
        expect(updated.description).toBe("Updated description");
        expect(updated.budgetCode).toBe("BG-2026-X");
      });

      it("rejects updating name to reserved identity 'NX Media'", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Standard Div",
          code: "STND",
        });

        await expect(
          updateDivision(adminOrgA, div._id, {
            name: "NX Media",
          })
        ).rejects.toThrow(/RESERVED_DIVISION_NAME_PROHIBITED/);
      });

      it("blocks cross-tenant update attempts", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Org A Div",
          code: "OAD",
        });

        await expect(
          updateDivision(adminOrgB, div._id, {
            name: "Tampered Name",
          })
        ).rejects.toThrow(/FORBIDDEN/);
      });
    });

    describe("archiveDivision & Archival Restrictions", () => {
      it("prevents archival when active departments depend on the division", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Division With Dept",
          code: "DWD",
        });

        await Department.create({
          organizationId: orgAId,
          divisionId: div._id,
          name: "Active Dept In Div",
          status: "ACTIVE",
        });

        await expect(archiveDivision(adminOrgA, div._id)).rejects.toThrow(
          /ARCHIVAL_BLOCKED_DEPENDENTS_EXIST/
        );
      });

      it("prevents archival when active teams depend on the division", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Division With Team",
          code: "DWT",
        });

        const dummyDept = new mongoose.Types.ObjectId();
        await Team.create({
          organizationId: orgAId,
          departmentId: dummyDept,
          divisionId: div._id,
          name: "Active Team In Div",
          status: "ACTIVE",
        });

        await expect(archiveDivision(adminOrgA, div._id)).rejects.toThrow(
          /ARCHIVAL_BLOCKED_DEPENDENTS_EXIST/
        );
      });

      it("prevents archival when active users depend on the division", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Division With User",
          code: "DWU",
        });

        await User.create({
          fullName: "Active Division Employee",
          email: `div_emp_${Date.now()}@nxworkos.test`,
          passwordHash: "secret",
          role: "EMPLOYEE",
          employmentType: "EMPLOYEE",
          organizationId: orgAId,
          divisionId: div._id,
          status: "ACTIVE",
        });

        await expect(archiveDivision(adminOrgA, div._id)).rejects.toThrow(
          /ARCHIVAL_BLOCKED_DEPENDENTS_EXIST/
        );
      });

      it("permits archival when no active dependent records exist", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Empty Division For Archival",
          code: "EMPTY",
        });

        const archived = await archiveDivision(adminOrgA, div._id);
        expect(archived.status).toBe("ARCHIVED");
      });

      it("permits archival when explicit approved archival workflow is supplied", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Approved Workflow Division",
          code: "APPRV",
        });

        await Department.create({
          organizationId: orgAId,
          divisionId: div._id,
          name: "Legacy Dept To Be Migrated",
          status: "ACTIVE",
        });

        const archived = await archiveDivision(adminOrgA, div._id, { approvedWorkflow: true });
        expect(archived.status).toBe("ARCHIVED");

        // Verify dependent records were NOT automatically modified or wiped
        const dept = await Department.findOne({ divisionId: div._id });
        expect(dept).not.toBeNull();
        expect(String(dept?.divisionId)).toBe(String(div._id));
      });
    });

    describe("deactivateDivision", () => {
      it("deactivates division by setting status to INACTIVE", async () => {
        const div = await createDivision(adminOrgA, {
          name: "To Deactivate",
          code: "DEACT",
        });

        const deactivated = await deactivateDivision(adminOrgA, div._id);
        expect(deactivated.status).toBe("INACTIVE");
      });
    });

    describe("getDivisionById & listDivisions", () => {
      it("getDivisionById returns division for authorized admin", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Readable Div",
          code: "READ",
        });

        const fetched = await getDivisionById(adminOrgA, div._id);
        expect(fetched).not.toBeNull();
        expect(fetched?.name).toBe("Readable Div");
      });

      it("getDivisionById blocks cross-tenant admin access", async () => {
        const div = await createDivision(adminOrgA, {
          name: "Org A Private Div",
          code: "OAPD",
        });

        await expect(getDivisionById(adminOrgB, div._id)).rejects.toThrow(/FORBIDDEN/);
      });

      it("listDivisions filters by authenticated organization", async () => {
        await createDivision(adminOrgA, { name: "Org A Div 1", code: "OAD1" });
        await createDivision(adminOrgA, { name: "Org A Div 2", code: "OAD2" });
        await createDivision(adminOrgB, { name: "Org B Div 1", code: "OBD1" });

        const listA = await listDivisions(adminOrgA);
        expect(listA.items).toHaveLength(2);
        for (const item of listA.items) {
          expect(String(item.organizationId)).toBe(String(orgAId));
        }

        const listB = await listDivisions(adminOrgB);
        expect(listB.items).toHaveLength(1);
        expect(String(listB.items[0].organizationId)).toBe(String(orgBId));
      });
    });
  });

  // =========================================================================
  // 3. AUTHORIZATION HELPERS TESTS
  // =========================================================================
  describe("3. Authorization Helpers (backend/src/utils/divisionAuth.ts)", () => {
    let activeDivA: any;
    let activeDivB: any;
    let inactiveDivA: any;

    let divAdminUserA: any;
    let unassignedDivAdmin: any;

    beforeEach(async () => {
      activeDivA = await Division.create({
        organizationId: orgAId,
        name: "Division Alpha",
        code: "ALPHA",
        status: "ACTIVE",
      });

      activeDivB = await Division.create({
        organizationId: orgAId,
        name: "Division Beta",
        code: "BETA",
        status: "ACTIVE",
      });

      inactiveDivA = await Division.create({
        organizationId: orgAId,
        name: "Division Suspended",
        code: "SUSP1",
        status: "INACTIVE",
      });

      divAdminUserA = {
        _id: new mongoose.Types.ObjectId(),
        fullName: "Division Alpha Admin",
        email: "div_admin_alpha@nxworkos.test",
        role: "DIVISION_ADMIN",
        organizationId: orgAId,
        divisionId: activeDivA._id,
        status: "ACTIVE",
      };

      unassignedDivAdmin = {
        _id: new mongoose.Types.ObjectId(),
        fullName: "Unassigned Division Admin",
        email: "unassigned_admin@nxworkos.test",
        role: "DIVISION_ADMIN",
        organizationId: orgAId,
        divisionId: null,
        status: "ACTIVE",
      };
    });

    describe("SUPER_ADMIN Platform-Level Access", () => {
      it("grants SUPER_ADMIN access across all divisions and organizations", async () => {
        expect(await hasDivisionAccess(superAdminUser, activeDivA)).toBe(true);
        expect(await hasDivisionAccess(superAdminUser, activeDivB)).toBe(true);
        expect(
          await hasDivisionAccess(superAdminUser, {
            organizationId: orgBId,
            divisionId: new mongoose.Types.ObjectId(),
          })
        ).toBe(true);

        await expect(validateDivisionScope(superAdminUser, activeDivA)).resolves.not.toThrow();
      });
    });

    describe("ADMIN Organization-Scoped Access", () => {
      it("grants ADMIN access to divisions within their authenticated organization", async () => {
        expect(await hasDivisionAccess(adminOrgA, activeDivA)).toBe(true);
        expect(await hasDivisionAccess(adminOrgA, activeDivB)).toBe(true);
        await expect(validateDivisionScope(adminOrgA, activeDivA)).resolves.not.toThrow();
      });

      it("denies ADMIN access to divisions in other organizations", async () => {
        const foreignDiv = {
          _id: new mongoose.Types.ObjectId(),
          organizationId: orgBId,
          name: "Foreign Div",
        };

        expect(await hasDivisionAccess(adminOrgA, foreignDiv)).toBe(false);
        await expect(validateDivisionScope(adminOrgA, foreignDiv)).rejects.toThrow(
          /CROSS_TENANT_ACCESS_DENIED/
        );
      });
    });

    describe("DIVISION_ADMIN Access Boundaries", () => {
      it("grants DIVISION_ADMIN access to their explicitly assigned active division", async () => {
        expect(await hasDivisionAccess(divAdminUserA, activeDivA)).toBe(true);
        await expect(validateDivisionScope(divAdminUserA, activeDivA)).resolves.not.toThrow();
      });

      it("denies access when DIVISION_ADMIN has missing or null division assignment", async () => {
        expect(await hasDivisionAccess(unassignedDivAdmin, activeDivA)).toBe(false);
        await expect(validateDivisionScope(unassignedDivAdmin, activeDivA)).rejects.toThrow(
          /NULL_DIVISION_ASSIGNMENT/
        );
      });

      it("denies access when assigned division is inactive or archived", async () => {
        const inactiveDivAdmin = {
          _id: new mongoose.Types.ObjectId(),
          role: "DIVISION_ADMIN",
          organizationId: orgAId,
          divisionId: inactiveDivA._id,
        };

        expect(await hasDivisionAccess(inactiveDivAdmin, inactiveDivA)).toBe(false);
        await expect(validateDivisionScope(inactiveDivAdmin, inactiveDivA)).rejects.toThrow(
          /INACTIVE_DIVISION/
        );
      });

      it("denies DIVISION_ADMIN access to other divisions in the same organization", async () => {
        expect(await hasDivisionAccess(divAdminUserA, activeDivB)).toBe(false);
        await expect(validateDivisionScope(divAdminUserA, activeDivB)).rejects.toThrow(
          /DIVISION_ACCESS_DENIED/
        );
      });

      it("denies DIVISION_ADMIN implicit access to Central Headquarters records (isCentral: true)", async () => {
        const centralRecord = {
          _id: new mongoose.Types.ObjectId(),
          organizationId: orgAId,
          isCentral: true,
          divisionId: null,
          name: "Central HQ Records",
        };

        expect(await hasDivisionAccess(divAdminUserA, centralRecord)).toBe(false);
        await expect(validateDivisionScope(divAdminUserA, centralRecord)).rejects.toThrow(
          /CENTRAL_RECORD_ACCESS_DENIED/
        );
      });

      it("denies DIVISION_ADMIN implicit access to legacy unclassified records (divisionId: null)", async () => {
        const legacyUnclassifiedRecord = {
          _id: new mongoose.Types.ObjectId(),
          organizationId: orgAId,
          divisionId: null,
          name: "Unclassified Legacy Record",
        };

        expect(await hasDivisionAccess(divAdminUserA, legacyUnclassifiedRecord)).toBe(false);
        await expect(
          validateDivisionScope(divAdminUserA, legacyUnclassifiedRecord)
        ).rejects.toThrow(/UNCLASSIFIED_RECORD_ACCESS_DENIED/);
      });

      it("Cross-division collaboration: allows read access but strictly denies edit access based solely on collaboration metadata", async () => {
        const crossDivProject = {
          _id: new mongoose.Types.ObjectId(),
          organizationId: orgAId,
          divisionId: activeDivB._id, // Primary owner is Div B
          isCrossDivision: true,
          collaboratingDivisionIds: [activeDivA._id], // Div A is collaborator
          name: "Joint Enterprise Project",
        };

        // READ / VIEW access is permitted
        expect(await hasDivisionAccess(divAdminUserA, crossDivProject, { action: "read" })).toBe(
          true
        );
        expect(await hasDivisionAccess(divAdminUserA, crossDivProject, { action: "view" })).toBe(
          true
        );
        await expect(
          validateDivisionScope(divAdminUserA, crossDivProject, { action: "read" })
        ).resolves.not.toThrow();

        // EDIT / UPDATE / DELETE access is strictly DENIED
        expect(await hasDivisionAccess(divAdminUserA, crossDivProject, { action: "edit" })).toBe(
          false
        );
        expect(
          await hasDivisionAccess(divAdminUserA, crossDivProject, { action: "update" })
        ).toBe(false);
        expect(
          await hasDivisionAccess(divAdminUserA, crossDivProject, { action: "delete" })
        ).toBe(false);

        await expect(
          validateDivisionScope(divAdminUserA, crossDivProject, { action: "edit" })
        ).rejects.toThrow(/CROSS_DIVISION_EDIT_DENIED/);
      });

      it("Compensation, central HR, and private files: no expanded permissions by default", async () => {
        // Compensation domain: denied by default for division admin
        expect(
          await hasDivisionAccess(divAdminUserA, activeDivA, { domain: "compensation" })
        ).toBe(false);
        await expect(
          validateDivisionScope(divAdminUserA, activeDivA, { domain: "compensation" })
        ).rejects.toThrow(/COMPENSATION_ACCESS_DENIED/);

        // Central HR domain: denied by default
        expect(await hasDivisionAccess(divAdminUserA, activeDivA, { domain: "hr" })).toBe(false);
        await expect(
          validateDivisionScope(divAdminUserA, activeDivA, { domain: "hr" })
        ).rejects.toThrow(/HR_ACCESS_DENIED/);

        // Private file belonging to another user: denied
        const privateFile = {
          _id: new mongoose.Types.ObjectId(),
          organizationId: orgAId,
          divisionId: activeDivA._id,
          visibility: "PRIVATE",
          ownerId: new mongoose.Types.ObjectId(), // Different owner
          uploadedBy: new mongoose.Types.ObjectId(),
        };
        expect(
          await hasDivisionAccess(divAdminUserA, privateFile, { domain: "file" })
        ).toBe(false);
      });
    });

    describe("Unauthorized Role Assignment Verification (validateRoleAssignment)", () => {
      it("prevents non-SUPER_ADMIN from assigning SUPER_ADMIN role", () => {
        expect(() => validateRoleAssignment(adminOrgA, "SUPER_ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(hrOrgA, "SUPER_ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(divAdminUserA, "SUPER_ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(employeeOrgA, "SUPER_ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );

        // Allowed for SUPER_ADMIN
        expect(() => validateRoleAssignment(superAdminUser, "SUPER_ADMIN")).not.toThrow();
      });

      it("prevents unauthorized roles (HR, MANAGER, EMPLOYEE, DIVISION_ADMIN) from assigning ADMIN role", () => {
        expect(() => validateRoleAssignment(hrOrgA, "ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(divAdminUserA, "ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(managerOrgA, "ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(employeeOrgA, "ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );

        // Allowed for SUPER_ADMIN and ADMIN within same organization
        expect(() =>
          validateRoleAssignment(adminOrgA, "ADMIN", { targetOrgId: orgAId })
        ).not.toThrow();
        expect(() =>
          validateRoleAssignment(superAdminUser, "ADMIN", { targetOrgId: orgBId })
        ).not.toThrow();
      });

      it("prevents ADMIN from assigning ADMIN in another organization (cross-tenant)", () => {
        expect(() =>
          validateRoleAssignment(adminOrgA, "ADMIN", { targetOrgId: orgBId })
        ).toThrow(/CROSS_TENANT_ROLE_ASSIGNMENT/);
      });

      it("prevents unauthorized roles (HR, MANAGER, EMPLOYEE, DIVISION_ADMIN) from assigning DIVISION_ADMIN role", () => {
        expect(() => validateRoleAssignment(hrOrgA, "DIVISION_ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(divAdminUserA, "DIVISION_ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );
        expect(() => validateRoleAssignment(employeeOrgA, "DIVISION_ADMIN")).toThrow(
          /UNAUTHORIZED_ROLE_ASSIGNMENT/
        );

        // Allowed for SUPER_ADMIN and ADMIN within same organization
        expect(() =>
          validateRoleAssignment(adminOrgA, "DIVISION_ADMIN", { targetOrgId: orgAId })
        ).not.toThrow();
        expect(() =>
          validateRoleAssignment(superAdminUser, "DIVISION_ADMIN", { targetOrgId: orgBId })
        ).not.toThrow();
      });

      it("prevents ADMIN from assigning DIVISION_ADMIN in another organization (cross-tenant)", () => {
        expect(() =>
          validateRoleAssignment(adminOrgA, "DIVISION_ADMIN", { targetOrgId: orgBId })
        ).toThrow(/CROSS_TENANT_ROLE_ASSIGNMENT/);
      });
    });
  });
});
