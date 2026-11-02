import mongoose from "mongoose";
import { connectToDatabase, disconnectDatabase } from "../src/config/database";

async function inspect() {
  try {
    await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) {
      console.log("No DB connection");
      return;
    }

    const collections = await db.listCollections().toArray();
    console.log("=== DATABASE COLLECTIONS AND COUNTS ===");
    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`- ${col.name}: ${count} documents`);
    }

    console.log("\n=== USERS BREAKDOWN BY ROLE ===");
    const users = await db.collection("users").find({}).project({ email: 1, fullName: 1, role: 1, employeeId: 1, organizationId: 1 }).toArray();
    for (const u of users) {
      console.log(`User: ${u.email} | Name: ${u.fullName} | Role: ${u.role} | Org: ${u.organizationId} | EmpId: ${u.employeeId}`);
    }

    console.log("\n=== ORGANIZATIONS ===");
    const orgs = await db.collection("organizations").find({}).toArray();
    for (const o of orgs) {
      console.log(`Org: ${o._id} | Name: ${o.name} | Code: ${o.code}`);
    }

    console.log("\n=== DEPARTMENTS & TEAMS ===");
    const depts = await db.collection("departments").find({}).toArray();
    for (const d of depts) {
      console.log(`Dept: ${d._id} | Name: ${d.name} | Org: ${d.organizationId}`);
    }
    const teams = await db.collection("teams").find({}).toArray();
    for (const t of teams) {
      console.log(`Team: ${t._id} | Name: ${t.name} | Dept: ${t.departmentId} | Lead: ${t.teamLeadId} | Manager: ${t.managerId || "none"}`);
    }

  } catch (err) {
    console.error("Error inspecting db:", err);
  } finally {
    await disconnectDatabase();
  }
}

inspect();
