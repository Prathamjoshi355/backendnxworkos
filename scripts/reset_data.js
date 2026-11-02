const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/nxplatform";

async function runReset(isDryRun = true) {
  try {
    console.log(`\n======================================================`);
    console.log(`   NEXISPARKX CONTROLLED DATA RESET (${isDryRun ? "DRY-RUN" : "EXECUTION"})`);
    console.log(`======================================================\n`);

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;

    // 1. Identify Super Admin and Admin accounts
    const superAdmins = await db.collection("users").find({ role: "SUPER_ADMIN" }).toArray();
    const admins = await db.collection("users").find({ role: "ADMIN" }).toArray();
    const preservedUserIds = [...superAdmins, ...admins].map((u) => u._id);

    console.log(`🛡️  PRESERVED ADMINISTRATIVE USERS (${preservedUserIds.length}):`);
    for (const u of [...superAdmins, ...admins]) {
      console.log(`   - [${u.role}] ${u.email} (${u.fullName}) | ID: ${u._id}`);
    }

    // 2. Identify required Organizations
    const mainOrg = await db.collection("organizations").findOne({ name: /nexisparkx/i }) 
      || await db.collection("organizations").findOne({});
    const preservedOrgIds = mainOrg ? [mainOrg._id] : [];

    console.log(`\n🏢 PRESERVED ORGANIZATIONS (${preservedOrgIds.length}):`);
    if (mainOrg) {
      console.log(`   - ${mainOrg.name} | ID: ${mainOrg._id}`);
    }

    // 3. Update Admin user's organizationId to mainOrg if null
    if (!isDryRun && mainOrg) {
      await db.collection("users").updateMany(
        { role: { $in: ["SUPER_ADMIN", "ADMIN"] }, organizationId: null },
        { $set: { organizationId: mainOrg._id } }
      );
    }

    // 4. Calculate counts to delete
    const usersToDelete = await db.collection("users").countDocuments({ _id: { $nin: preservedUserIds } });
    const otherOrgsToDelete = await db.collection("organizations").countDocuments({ _id: { $nin: preservedOrgIds } });
    const deptsToDelete = await db.collection("departments").countDocuments({ organizationId: { $nin: preservedOrgIds } });
    const teamsToDelete = await db.collection("teams").countDocuments({});
    const tasksToDelete = await db.collection("tasks").countDocuments({});
    const leavesToDelete = await db.collection("leaves").countDocuments({});
    const attendancesToDelete = await db.collection("attendances").countDocuments({});
    const breaksToDelete = await db.collection("breaks").countDocuments({});
    const workSessionsToDelete = await db.collection("worksessions").countDocuments({});
    const dailyReportsToDelete = await db.collection("dailyreports").countDocuments({});
    const leadsToDelete = await db.collection("leads").countDocuments({});
    const followupsToDelete = await db.collection("followups").countDocuments({});
    const leadImportsToDelete = await db.collection("leadimports").countDocuments({});
    const auditLogsToDelete = await db.collection("auditlogs").countDocuments({});

    console.log(`\n📊 INVENTORY BREAKDOWN:`);
    console.log(`   - Users: Preserve ${preservedUserIds.length} | Delete ${usersToDelete} test/demo users`);
    console.log(`   - Organizations: Preserve ${preservedOrgIds.length} | Delete ${otherOrgsToDelete} test orgs`);
    console.log(`   - Departments: Delete ${deptsToDelete} test departments (preserve main org depts)`);
    console.log(`   - Teams: Delete ${teamsToDelete} demo teams`);
    console.log(`   - Tasks: Delete ${tasksToDelete} demo tasks`);
    console.log(`   - Leaves: Delete ${leavesToDelete} demo leaves`);
    console.log(`   - Attendance & Sessions: Delete ${attendancesToDelete + breaksToDelete + workSessionsToDelete} demo attendance records`);
    console.log(`   - Daily Reports: Delete ${dailyReportsToDelete} demo reports`);
    console.log(`   - Leads & CRM: Delete ${leadsToDelete + followupsToDelete + leadImportsToDelete} demo CRM records`);
    console.log(`   - Audit Logs: Delete ${auditLogsToDelete} test logs`);

    console.log(`\n⚙️  SYSTEM CONFIGURATION PRESERVED:`);
    console.log(`   - Leave Types: ${await db.collection("leavetypes").countDocuments()} items`);
    console.log(`   - Point Rules: ${await db.collection("pointrules").countDocuments()} items`);
    console.log(`   - Products: ${await db.collection("products").countDocuments()} items`);

    if (isDryRun) {
      console.log(`\n🔍 DRY RUN COMPLETE: No data was modified.`);
      return;
    }

    // 5. Perform safe ordered execution
    console.log(`\n🚀 EXECUTING CONTROLLED RESET...`);

    await db.collection("users").deleteMany({ _id: { $nin: preservedUserIds } });
    await db.collection("organizations").deleteMany({ _id: { $nin: preservedOrgIds } });
    await db.collection("departments").deleteMany({ organizationId: { $nin: preservedOrgIds } });
    await db.collection("teams").deleteMany({});
    await db.collection("tasks").deleteMany({});
    await db.collection("leaves").deleteMany({});
    await db.collection("attendances").deleteMany({});
    await db.collection("breaks").deleteMany({});
    await db.collection("worksessions").deleteMany({});
    await db.collection("dailyreports").deleteMany({});
    await db.collection("leads").deleteMany({});
    await db.collection("followups").deleteMany({});
    await db.collection("leadimports").deleteMany({});
    await db.collection("leadassignments").deleteMany({});
    await db.collection("leadquotas").deleteMany({});
    await db.collection("meetings").deleteMany({});
    await db.collection("targets").deleteMany({});
    await db.collection("performancesnapshots").deleteMany({});
    await db.collection("tasktimesessions").deleteMany({});
    await db.collection("notifications").deleteMany({});
    await db.collection("announcements").deleteMany({});
    await db.collection("calllogs").deleteMany({});
    await db.collection("employeedocuments").deleteMany({});
    await db.collection("compensations").deleteMany({});
    await db.collection("compensationaudits").deleteMany({});
    await db.collection("auditlogs").deleteMany({});

    console.log(`✅ Controlled data reset completed successfully!`);
    console.log(`   Super Admin and Admin accounts, NexisparkX organization, and System settings are intact.\n`);

  } catch (err) {
    console.error("Reset error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

const isExecute = process.argv.includes("--execute");
runReset(!isExecute);
