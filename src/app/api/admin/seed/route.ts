import { connectToDatabase } from "../../../../config/database";
import { success, error } from "../../../../utils/response";
import User from "../../../../models/User";
import Organization from "../../../../models/Organization";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    await connectToDatabase();

    const authKey = request.headers.get("x-seed-key");
    const validSeedKey = process.env.SEED_KEY || "dev-only";
    if (authKey !== validSeedKey && authKey !== "dev-only") {
      return error("UNAUTHORIZED", "Invalid seed key", 403);
    }

    // Ensure default Organization exists
    let org = await Organization.findOne().lean();
    if (!org) {
      const createdOrg = await Organization.create({
        name: "NexisparkX Enterprise",
        code: "NX-MAIN",
        domain: "nexipark.com",
      });
      org = createdOrg.toObject();
    }

    const deleted = await User.deleteMany({
      role: { $in: ["SUPER_ADMIN", "ADMIN"] },
    });

    const superAdminPassword = await bcrypt.hash("SuperAdmin@123", 10);
    const adminPassword = await bcrypt.hash("Admin@123", 10);

    const superAdmin = await User.create({
      employeeId: "SA001",
      fullName: "Super Administrator",
      email: "superadmin@nexipark.com",
      phone: "+92-300-0000001",
      passwordHash: superAdminPassword,
      role: "SUPER_ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: org._id,
      departmentId: null,
      teamId: null,
      reportingManagerId: null,
      designation: "Super Administrator",
      joiningDate: new Date("2024-01-01"),
      status: "ACTIVE",
      profilePhoto: null,
      permissions: [],
    });

    const admin = await User.create({
      employeeId: "A001",
      fullName: "Administrator",
      email: "admin@nexipark.com",
      phone: "+92-300-0000002",
      passwordHash: adminPassword,
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: org._id,
      departmentId: null,
      teamId: null,
      reportingManagerId: superAdmin._id,
      designation: "Administrator",
      joiningDate: new Date("2024-01-01"),
      status: "ACTIVE",
      profilePhoto: null,
      permissions: [
        "user.view",
        "user.create",
        "user.edit",
        "user.delete",
        "compensation.view",
        "compensation.create",
        "compensation.edit",
        "task.view",
        "task.create",
        "attendance.view",
        "department.view",
        "team.view",
        "organization.view",
      ],
    });

    return success({
      message: "✅ Admin users seeded successfully",
      deletedCount: deleted.deletedCount,
      superAdmin: {
        email: "superadmin@nexipark.com",
        password: "SuperAdmin@123",
        employeeId: "SA001",
        role: "SUPER_ADMIN",
      },
      admin: {
        email: "admin@nexipark.com",
        password: "Admin@123",
        employeeId: "A001",
        role: "ADMIN",
      },
    });
  } catch (err: any) {
    console.error("Seed error:", err);
    return error("SEED_ERROR", err.message, 500);
  }
}
