const { connectToDatabase, disconnectDatabase } = require('./dist/config/database');
const { loginUser } = require('./dist/services/authService');

async function testLocalAuthLogic() {
  console.log("Testing authService login with updated connectToDatabase...");
  try {
    await connectToDatabase();
    console.log("Connected to DB.");

    const saRes = await loginUser("superadmin@nexipark.com", "SuperAdmin@123");
    console.log("✅ Super Admin Login Success!");
    console.log("   Role:", saRes.user.role);
    console.log("   Org ID:", saRes.user.organizationId);
    console.log("   Status:", saRes.user.status);
    console.log("   Token length:", saRes.token ? saRes.token.length : 0);

    const adminRes = await loginUser("admin@nexipark.com", "Admin@123");
    console.log("\n✅ Admin Login Success!");
    console.log("   Role:", adminRes.user.role);
    console.log("   Org ID:", adminRes.user.organizationId);
    console.log("   Status:", adminRes.user.status);
    console.log("   Token length:", adminRes.token ? adminRes.token.length : 0);

  } catch (err) {
    console.error("❌ Auth Test Failed:", err);
  } finally {
    await disconnectDatabase();
  }
}

testLocalAuthLogic();
