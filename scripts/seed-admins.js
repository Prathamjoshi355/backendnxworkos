const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// Connection string - using local MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/nexipark";

async function seedAdminUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to database");

    // Import User model
    const User = require("../src/models/User").default;

    // Delete existing admins to allow re-seeding
    const deleted = await User.deleteMany({
      role: { $in: ["SUPER_ADMIN", "ADMIN"] },
    });
    console.log(`🗑️  Cleared ${deleted.deletedCount} existing admin users`);

    // Hash passwords
    const superAdminPassword = await bcrypt.hash("SuperAdmin@123", 10);
    const adminPassword = await bcrypt.hash("Admin@123", 10);

    // Create Super Admin User
    const superAdmin = await User.create({
      employeeId: "SA001",
      fullName: "Super Administrator",
      email: "superadmin@nexipark.com",
      phone: "+92-300-0000001",
      passwordHash: superAdminPassword,
      role: "SUPER_ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: null,
      departmentId: null,
      teamId: null,
      reportingManagerId: null,
      designation: "Super Administrator",
      joiningDate: new Date("2024-01-01"),
      status: "ACTIVE",
      profilePhoto: null,
      permissions: [], // Super Admin has all permissions automatically
    });

    console.log("\n✅ Super Admin Created:");
    console.log(`   📧 Email: superadmin@nexipark.com`);
    console.log(`   🔐 Password: SuperAdmin@123`);
    console.log(`   🆔 Employee ID: SA001`);
    console.log(`   👤 Role: SUPER_ADMIN`);
    console.log(`   🔑 Permissions: All (Automatically)`);

    // Create Admin User
    const admin = await User.create({
      employeeId: "A001",
      fullName: "Administrator",
      email: "admin@nexipark.com",
      phone: "+92-300-0000002",
      passwordHash: adminPassword,
      role: "ADMIN",
      employmentType: "EMPLOYEE",
      organizationId: null,
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

    console.log("\n✅ Admin Created:");
    console.log(`   📧 Email: admin@nexipark.com`);
    console.log(`   🔐 Password: Admin@123`);
    console.log(`   🆔 Employee ID: A001`);
    console.log(`   👤 Role: ADMIN`);
    console.log(`   🔑 Permissions:`);
    console.log(`      ✓ Can create/edit/delete users`);
    console.log(`      ✓ Can view compensation`);
    console.log(`      ✓ Can create tasks`);
    console.log(`      ✓ Can view attendance`);

    console.log("\n" + "=".repeat(60));
    console.log("📋 PERMISSIONS BREAKDOWN");
    console.log("=".repeat(60));

    console.log("\n🔴 SUPER ADMIN (superadmin@nexipark.com):");
    console.log("   ✅ Can add/manage ADMIN users");
    console.log("   ✅ Can add/manage all EMPLOYEE types");
    console.log("   ✅ Can create/manage organizations");
    console.log("   ✅ Can create/manage departments");
    console.log("   ✅ Can create/manage teams");
    console.log("   ✅ Full access to all system features");
    console.log("   ✅ Can view all reports and data");

    console.log("\n🟠 ADMIN (admin@nexipark.com):");
    console.log("   ✅ Can add/manage EMPLOYEE users");
    console.log("   ✅ Can add INTERN users");
    console.log("   ✅ Can add DESIGNER users");
    console.log("   ✅ Can add SALES_EXECUTIVE users");
    console.log("   ✅ Can create compensation records");
    console.log("   ✅ Can create and assign tasks");
    console.log("   ✅ Can view attendance reports");
    console.log("   ✅ Can edit user information");
    console.log("   ❌ Cannot add/manage ADMIN users");
    console.log("   ❌ Cannot manage organizations");
    console.log("   ❌ Cannot delete users (only edit)");

    console.log("\n" + "=".repeat(60));
    console.log("🔐 TEST CREDENTIALS");
    console.log("=".repeat(60));

    console.log("\n🔴 Super Admin:");
    console.log("   Email: superadmin@nexipark.com");
    console.log("   Password: SuperAdmin@123");
    console.log("   Can: Add admins, manage everything");

    console.log("\n🟠 Admin:");
    console.log("   Email: admin@nexipark.com");
    console.log("   Password: Admin@123");
    console.log("   Can: Add employees, manage team");

    console.log("\n✅ Seed completed successfully!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("❌ Error seeding admin users:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

seedAdminUsers();
