import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Organization from "../src/models/Organization";
import Department from "../src/models/Department";
import User from "../src/models/User";
import PermissionProfile from "../src/models/PermissionProfile";
import DepartmentTemplate from "../src/models/DepartmentTemplate";
import * as permService from "../src/services/centralPermissionService";
import * as deptTemplateService from "../src/services/departmentTemplateService";
import * as userService from "../src/services/userService";

describe("NXWorkOS: Central Organization-wide Permission Engine End-to-End Tests", () => {
  let mongoServer: MongoMemoryServer;

  let testOrg: any;
  let otherOrg: any;
  let hrDept: any;
  let financeDept: any;
  let engDept: any;

  let superAdminUser: any;
  let adminUser: any;
  let hrUser: any;
  let accountantUser: any;
  let devUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    testOrg = await Organization.create({
      name: "NexisparkX Enterprise",
      legalName: "NexisparkX Enterprise",
      slug: "nexisparkx-ent",
      status: "ACTIVE",
    });

    otherOrg = await Organization.create({
      name: "Different Corp",
      legalName: "Different Corp",
      slug: "diff-corp",
      status: "ACTIVE",
    });

    // Ensure predefined profiles exist
    await permService.ensurePredefinedPermissionProfiles();
    await deptTemplateService.ensureGenericDepartmentTemplates();

    // Create departments
    hrDept = await Department.create({
      name: "Human Resources",
      code: "HR",
      organizationId: testOrg._id,
      status: "ACTIVE",
    });

    financeDept = await Department.create({
      name: "Finance & Accounts",
      code: "FIN",
      organizationId: testOrg._id,
      status: "ACTIVE",
    });

    engDept = await Department.create({
      name: "Software Engineering",
      code: "ENG",
      organizationId: testOrg._id,
      status: "ACTIVE",
    });

    // Users
    superAdminUser = await User.create({
      fullName: "Super Admin",
      email: "sa@test.com",
      role: "SUPER_ADMIN",
      organizationId: testOrg._id,
      passwordHash: "hash",
    });

    adminUser = await User.create({
      fullName: "Admin",
      email: "admin@test.com",
      role: "ADMIN",
      organizationId: testOrg._id,
      passwordHash: "hash",
    });

    hrUser = await User.create({
      fullName: "HR Specialist",
      email: "hr@test.com",
      role: "EMPLOYEE",
      organizationId: testOrg._id,
      departmentId: String(hrDept._id),
      designation: "HR Officer",
      passwordHash: "hash",
    });

    accountantUser = await User.create({
      fullName: "Senior Accountant",
      email: "acc@test.com",
      role: "EMPLOYEE",
      organizationId: testOrg._id,
      departmentId: String(financeDept._id),
      designation: "Accountant",
      passwordHash: "hash",
    });

    devUser = await User.create({
      fullName: "Software Developer",
      email: "dev@test.com",
      role: "EMPLOYEE",
      organizationId: testOrg._id,
      departmentId: String(engDept._id),
      designation: "Software Engineer",
      passwordHash: "hash",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("1. Master Catalogue & Predefined Profiles", () => {
    it("should provide full master permission catalogue", async () => {
      const catalog = permService.MASTER_PERMISSION_CATALOGUE;
      expect(catalog.length).toBeGreaterThan(40);
      expect(catalog).toContain("document.view");
      expect(catalog).toContain("document.create");
      expect(catalog).toContain("document.download");
      expect(catalog).toContain("payroll.view.department");
      expect(catalog).toContain("system.admin.overview");
    });

    it("should have seeded standard department profiles", async () => {
      const profiles = await PermissionProfile.find({ isSystemPredefined: true });
      expect(profiles.length).toBeGreaterThanOrEqual(10);

      const hrHeadProfile = profiles.find((p) => p.code === "HR_HEAD");
      expect(hrHeadProfile).toBeDefined();
      expect(hrHeadProfile?.permissions).toContain("employee.create");
      expect(hrHeadProfile?.permissions).toContain("leave.approve.department");

      const accProfile = profiles.find((p) => p.code === "ACCOUNTANT");
      expect(accProfile).toBeDefined();
      expect(accProfile?.permissions).toContain("payroll.view.organization");
      expect(accProfile?.permissions).toContain("payroll.manage");
    });
  });

  describe("2. Deterministic Precedence Resolution Engine", () => {
    it("should resolve role defaults for basic EMPLOYEE", async () => {
      const perms = await permService.resolveEffectivePermissions(devUser);
      // Standard employee defaults
      expect(perms).toContain("employee.view.self");
      expect(perms).toContain("attendance.view.self");
      expect(perms).toContain("leave.apply.self");
      expect(perms).toContain("document.view");
      // Should not have admin permissions
      expect(perms).not.toContain("employee.create"); // Not present by default
    });

    it("should grant department profile permissions on top of role defaults", async () => {
      // Assign HR Head profile to hrUser
      const hrProfile = await PermissionProfile.findOne({ code: "HR_HEAD" });
      hrUser.departmentProfileId = hrProfile?._id;
      await hrUser.save();

      const perms = await permService.resolveEffectivePermissions(hrUser);
      expect(perms).toContain("employee.view.self"); // From role
      expect(perms).toContain("employee.create"); // From HR profile
      expect(perms).toContain("leave.approve.department"); // From HR profile
      expect(perms).toContain("attendance.correct"); // From HR profile
    });

    it("should apply explicit granted permissions override", async () => {
      // Give devUser explicit grant for document.create
      await permService.setUserPermissionOverrides(
        adminUser,
        String(devUser._id),
        ["document.create", "project.create"],
        []
      );

      const perms = await permService.resolveEffectivePermissions(devUser);
      expect(perms).toContain("document.create");
      expect(perms).toContain("project.create");
    });

    it("should enforce that EXPLICIT DENIAL ALWAYS WINS even over profile and role defaults", async () => {
      // Explicitly deny attendance.view.self and employee.create for hrUser
      await permService.setUserPermissionOverrides(
        adminUser,
        String(hrUser._id),
        [],
        ["attendance.view.self", "employee.create"]
      );

      const perms = await permService.resolveEffectivePermissions(hrUser);
      // Even though employee.create was in HR_HEAD profile, it MUST be absent!
      expect(perms.includes("employee.create")).toBe(false);
      // Even though attendance.view.self is a role default, it MUST be absent!
      expect(perms.includes("attendance.view.self")).toBe(false);

      // Other profile permissions still remain
      expect(perms).toContain("leave.approve.department");
    });

    it("hasPermission should return true when user has permission, false otherwise", async () => {
      const canApprove = await permService.hasPermission(hrUser, "leave.approve.department");
      expect(canApprove).toBe(true);

      const canCreateEmp = await permService.hasPermission(hrUser, "employee.create");
      expect(canCreateEmp).toBe(false); // Because explicitly denied!
    });
  });

  describe("3. Generic Department Templates & Catalog", () => {
    it("should seed 18 generic department templates", async () => {
      await deptTemplateService.ensureGenericDepartmentTemplates();

      const templates = await DepartmentTemplate.find({ isSystemCatalogue: true });
      expect(templates.length).toBe(18);

      const codes = templates.map((t) => t.code);
      expect(codes).toContain("HR");
      expect(codes).toContain("FINANCE");
      expect(codes).toContain("DEV_CORE");
      expect(codes).toContain("LEGAL_COMPLIANCE");
      expect(codes).toContain("SALES");
      expect(codes).toContain("ADMINISTRATION");
    });

    it("should enable department from generic template in organization", async () => {
      const legalTemplate = await DepartmentTemplate.findOne({ code: "LEGAL_COMPLIANCE" });
      expect(legalTemplate).toBeDefined();

      const newDept = await deptTemplateService.enableDepartmentFromTemplate(
        adminUser,
        String(legalTemplate?._id)
      );

      expect(newDept.name).toBe("Legal & Compliance");
      expect(newDept.code).toBe("LEGAL_COMPLIANCE");
      expect(String(newDept.organizationId)).toBe(String(testOrg._id));
      expect(newDept.permissionProfileId).toBeDefined();
    });
  });

  describe("4. Onboarding Auto-Assignment & Department Transfer Recalculation", () => {
    it("should auto-assign department profile on new user onboarding", async () => {
      const newEmp = await userService.createUser({
        fullName: "Finance Analyst",
        email: "analyst@nexisparkx.com",
        role: "EMPLOYEE",
        organizationId: String(testOrg._id),
        departmentId: String(financeDept._id),
        designation: "Financial Analyst",
      });

      expect(newEmp.departmentId).toBe(String(financeDept._id));
      expect(newEmp.departmentProfileId).toBeDefined();

      const assignedProfile = await PermissionProfile.findById(newEmp.departmentProfileId);
      expect(assignedProfile?.departmentCode).toBe("FIN");
    });

    it("should recalculate and clear old department profile on transfer to another department", async () => {
      const emp = await User.findOne({ email: "analyst@nexisparkx.com" });
      expect(emp?.departmentProfileId).toBeDefined();

      // Transfer from Finance to Engineering
      const updated = await userService.updateUser(String(emp?._id), {
        departmentId: String(engDept._id),
      });

      expect(String(updated.departmentId)).toBe(String(engDept._id));
      // Re-fetched user should have ENG department profile, not FIN
      const reFetched = await User.findById(emp?._id);
      expect(reFetched?.departmentProfileId).toBeDefined();
      const newProfile = await PermissionProfile.findById(reFetched?.departmentProfileId);
      expect(newProfile?.departmentCode).toBe("ENG");
    });
  });
});
