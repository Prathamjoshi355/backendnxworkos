import Lead from "../models/Lead";
import User from "../models/User";
import LeadQuota from "../models/LeadQuota";
import LeadAssignment from "../models/LeadAssignment";
import { createNotification } from "./notificationService";
import { emitLeadEvent } from "../realtime/crm";

export async function assignLeads(payload: {
  organizationId: string;
  assignedBy: string;
  mode: "MANUAL" | "EXCEL" | "EQUAL_DISTRIBUTION" | "ROUND_ROBIN" | "PRODUCT_QUOTA";
  leadIds?: string[];
  productId?: string;
  employeeId?: string;
  employeeIds?: string[];
  reason?: string;
}) {
  const { organizationId, assignedBy, mode, productId, reason } = payload;

  let leadsToAssign: any[] = [];
  if (payload.leadIds && payload.leadIds.length > 0) {
    leadsToAssign = await Lead.find({ organizationId, _id: { $in: payload.leadIds } });
  } else if (productId) {
    leadsToAssign = await Lead.find({ organizationId, productId, assignedTo: null });
  } else {
    leadsToAssign = await Lead.find({ organizationId, assignedTo: null });
  }

  if (leadsToAssign.length === 0) {
    return { assignedCount: 0, unassignedCount: 0, details: [] };
  }

  let assignedCount = 0;
  const assignmentDetails: any[] = [];

  if (mode === "MANUAL" && payload.employeeId) {
    const emp = await User.findOne({ _id: payload.employeeId, organizationId, status: "ACTIVE" }).lean();
    if (!emp) throw new Error("Employee not found or inactive");

    for (const lead of leadsToAssign) {
      const prevEmpId = lead.assignedTo;
      lead.assignedTo = emp._id as any;
      lead.assignedAt = new Date();
      await lead.save();

      await LeadAssignment.create({
        organizationId,
        leadId: lead._id,
        employeeId: emp._id,
        productId: lead.productId || null,
        assignedBy,
        assignmentMode: "MANUAL",
        assignedAt: new Date(),
        previousEmployeeId: prevEmpId,
        reason: reason || "Manual assignment",
      });

      assignedCount++;
      assignmentDetails.push({ leadId: lead.leadId, employeeId: emp._id, employeeName: emp.fullName });

      emitLeadEvent("lead:assigned", { leadId: String(lead._id), assignedTo: String(emp._id) });
    }

    await createNotification({
      organizationId,
      recipientId: String(emp._id),
      title: "New Leads Assigned",
      message: `You have been assigned ${assignedCount} new leads.`,
      type: "CRM_LEAD_ASSIGNED",
      entityType: "LEAD",
      entityId: String(leadsToAssign[0]._id),
    });
  } else if (mode === "EQUAL_DISTRIBUTION" && payload.employeeIds && payload.employeeIds.length > 0) {
    const employees = await User.find({ _id: { $in: payload.employeeIds }, organizationId, status: "ACTIVE" }).lean();
    if (employees.length === 0) throw new Error("No active eligible employees selected");

    for (let i = 0; i < leadsToAssign.length; i++) {
      const lead = leadsToAssign[i];
      const emp = employees[i % employees.length];
      const prevEmpId = lead.assignedTo;

      lead.assignedTo = emp._id as any;
      lead.assignedAt = new Date();
      await lead.save();

      await LeadAssignment.create({
        organizationId,
        leadId: lead._id,
        employeeId: emp._id,
        productId: lead.productId || null,
        assignedBy,
        assignmentMode: "EQUAL_DISTRIBUTION",
        assignedAt: new Date(),
        previousEmployeeId: prevEmpId,
        reason: reason || "Equal distribution",
      });

      assignedCount++;
      assignmentDetails.push({ leadId: lead.leadId, employeeId: emp._id, employeeName: emp.fullName });

      emitLeadEvent("lead:assigned", { leadId: String(lead._id), assignedTo: String(emp._id) });
    }
  } else if (mode === "ROUND_ROBIN" && payload.employeeIds && payload.employeeIds.length > 0) {
    const employees = await User.find({ _id: { $in: payload.employeeIds }, organizationId, status: "ACTIVE" }).lean();
    if (employees.length === 0) throw new Error("No active eligible employees selected");

    for (let i = 0; i < leadsToAssign.length; i++) {
      const lead = leadsToAssign[i];
      const emp = employees[i % employees.length];
      const prevEmpId = lead.assignedTo;

      lead.assignedTo = emp._id as any;
      lead.assignedAt = new Date();
      await lead.save();

      await LeadAssignment.create({
        organizationId,
        leadId: lead._id,
        employeeId: emp._id,
        productId: lead.productId || null,
        assignedBy,
        assignmentMode: "ROUND_ROBIN",
        assignedAt: new Date(),
        previousEmployeeId: prevEmpId,
        reason: reason || "Round Robin distribution",
      });

      assignedCount++;
      assignmentDetails.push({ leadId: lead.leadId, employeeId: emp._id, employeeName: emp.fullName });

      emitLeadEvent("lead:assigned", { leadId: String(lead._id), assignedTo: String(emp._id) });
    }
  } else if (mode === "PRODUCT_QUOTA" && productId) {
    const quotaRules = await LeadQuota.find({ organizationId, productId, status: "ACTIVE" }).lean();
    if (quotaRules.length === 0) throw new Error("No active quota rules found for this product");

    // Calculate current capacity for each rule
    const quotaMap: { rule: any; capacity: number; assigned: number }[] = [];
    for (const rule of quotaRules) {
      const currentAssigned = await Lead.countDocuments({ organizationId, productId, assignedTo: rule.employeeId });
      const capacity = Math.max(0, rule.maxLeads - currentAssigned);
      if (capacity > 0) {
        quotaMap.push({ rule, capacity, assigned: 0 });
      }
    }

    let leadIndex = 0;
    while (leadIndex < leadsToAssign.length) {
      const availableQuota = quotaMap.find((q) => q.assigned < q.capacity);
      if (!availableQuota) break; // All employee quotas reached

      const lead = leadsToAssign[leadIndex];
      const empId = availableQuota.rule.employeeId;
      const prevEmpId = lead.assignedTo;

      lead.assignedTo = empId as any;
      lead.assignedAt = new Date();
      await lead.save();

      await LeadAssignment.create({
        organizationId,
        leadId: lead._id,
        employeeId: empId,
        productId: lead.productId || null,
        assignedBy,
        assignmentMode: "PRODUCT_QUOTA",
        quotaRuleId: availableQuota.rule._id,
        assignedAt: new Date(),
        previousEmployeeId: prevEmpId,
        reason: reason || "Product Quota auto-assignment",
      });

      availableQuota.assigned++;
      assignedCount++;
      leadIndex++;

      emitLeadEvent("lead:assigned", { leadId: String(lead._id), assignedTo: String(empId) });
    }
  }

  const unassignedCount = Math.max(0, leadsToAssign.length - assignedCount);

  return {
    assignedCount,
    unassignedCount,
    details: assignmentDetails,
  };
}

export async function reassignLead(payload: {
  organizationId: string;
  leadId: string;
  newEmployeeId: string;
  reassignedBy: string;
  reason?: string;
}) {
  const { organizationId, leadId, newEmployeeId, reassignedBy, reason } = payload;
  const lead = await Lead.findOne({ _id: leadId, organizationId });
  if (!lead) throw new Error("Lead not found");

  const newEmp = await User.findOne({ _id: newEmployeeId, organizationId, status: "ACTIVE" }).lean();
  if (!newEmp) throw new Error("New employee not found or inactive");

  const prevEmpId = lead.assignedTo;
  lead.assignedTo = newEmp._id as any;
  lead.assignedAt = new Date();
  await lead.save();

  await LeadAssignment.create({
    organizationId,
    leadId: lead._id,
    employeeId: newEmp._id,
    productId: lead.productId || null,
    assignedBy: reassignedBy,
    assignmentMode: "MANUAL",
    assignedAt: new Date(),
    previousEmployeeId: prevEmpId,
    reason: reason || "Lead reassignment",
  });

  emitLeadEvent("lead:reassigned", { leadId: String(lead._id), assignedTo: String(newEmp._id) });

  await createNotification({
    organizationId,
    recipientId: String(newEmp._id),
    title: "Lead Reassigned to You",
    message: `Lead ${lead.name} (${lead.leadId}) has been reassigned to you.`,
    type: "CRM_LEAD_ASSIGNED",
    entityType: "LEAD",
    entityId: String(lead._id),
  });

  return lead.toObject();
}
