import mongoose from "mongoose";
import Lead from "../models/Lead";
import CallLog from "../models/CallLog";
import FollowUp from "../models/FollowUp";
import LeadAssignment from "../models/LeadAssignment";
import User from "../models/User";
import { createNotification } from "./notificationService";
import { emitLeadEvent } from "../realtime/crm";

function getLeadQuery(leadId: string, organizationId?: string) {
  const is24Hex = /^[0-9a-fA-F]{24}$/.test(leadId);
  const q: any = is24Hex ? { $or: [{ _id: new mongoose.Types.ObjectId(leadId) }, { leadId }] } : { leadId };
  if (organizationId) {
    q.organizationId = /^[0-9a-fA-F]{24}$/.test(organizationId)
      ? new mongoose.Types.ObjectId(organizationId)
      : organizationId;
  }
  return q;
}

export async function recordCall(payload: {
  organizationId: string;
  leadId: string;
  employeeId: string;
  outcome?: string;
  notes?: string;
  duration?: number;
}) {
  const { organizationId, leadId, employeeId, outcome, notes, duration } = payload;
  const lead = await Lead.findOne(getLeadQuery(leadId, organizationId));
  if (!lead) throw new Error("Lead not found");

  const callLog = await CallLog.create({
    leadId: lead._id,
    userId: employeeId,
    startedAt: new Date(),
    endedAt: new Date(),
    duration: duration || 0,
    outcome: (outcome as any) || "CONNECTED",
    notes: notes || null,
  });

  lead.callCount = (lead.callCount || 0) + 1;
  lead.lastContactedAt = new Date();
  lead.uncontacted = false;
  if (lead.status === "NEW") {
    lead.status = "CONTACTED";
    lead.pipelineStage = "CONTACTED";
  }
  await lead.save();

  emitLeadEvent("lead:updated", { leadId: String(lead._id), callCount: lead.callCount });
  return { callLog, lead: lead.toObject() };
}

export async function recordOutcome(payload: {
  organizationId: string;
  leadId: string;
  employeeId: string;
  outcome: "INTERESTED" | "FOLLOW_UP" | "NO_ANSWER" | "RESCHEDULED" | "REJECTED" | "NOT_INTERESTED" | "CALL_NOT_PICKED";
  remark?: string;
  rejectionReason?: string;
  followUpDate?: string | Date;
  nextAction?: string;
  priority?: "HOT" | "WARM" | "COLD";
}) {
  const { organizationId, leadId, employeeId, outcome, remark, rejectionReason, followUpDate, nextAction, priority } = payload;
  const lead = await Lead.findOne(getLeadQuery(leadId, organizationId));
  if (!lead) throw new Error("Lead not found");

  lead.callOutcome = outcome;
  lead.lastContactedAt = new Date();
  lead.uncontacted = false;
  lead.callCount = (lead.callCount || 0) + 1;
  if (priority) lead.priority = priority as any;
  if (nextAction) lead.nextAction = nextAction;
  if (remark) lead.notes = remark;

  let followUpRecord: any = null;

  if (outcome === "INTERESTED") {
    lead.status = "INTERESTED";
    lead.pipelineStage = "INTERESTED";

    if (followUpDate) {
      const scheduled = new Date(followUpDate);
      lead.status = "FOLLOW_UP";
      lead.pipelineStage = "FOLLOW_UP";
      lead.nextFollowUpAt = scheduled;

      followUpRecord = await FollowUp.create({
        leadId: lead._id,
        assignedTo: employeeId,
        scheduledAt: scheduled,
        reason: remark || "Interested customer follow-up",
        status: "SCHEDULED",
        createdBy: employeeId,
        notes: remark || null,
      });
    }
  } else if (outcome === "FOLLOW_UP") {
    lead.status = "FOLLOW_UP";
    lead.pipelineStage = "FOLLOW_UP";
    const scheduled = followUpDate ? new Date(followUpDate) : new Date(Date.now() + 86400000);
    lead.nextFollowUpAt = scheduled;

    followUpRecord = await FollowUp.create({
      leadId: lead._id,
      assignedTo: employeeId,
      scheduledAt: scheduled,
      reason: remark || "Scheduled follow-up call",
      status: "SCHEDULED",
      createdBy: employeeId,
      notes: remark || null,
    });
  } else if (outcome === "NO_ANSWER" || outcome === "CALL_NOT_PICKED") {
    lead.status = "NO_ANSWER";
    lead.pipelineStage = "CONTACTED";

    if (followUpDate) {
      const scheduled = new Date(followUpDate);
      lead.status = "RESCHEDULED";
      lead.pipelineStage = "RESCHEDULED";
      lead.nextFollowUpAt = scheduled;

      followUpRecord = await FollowUp.create({
        leadId: lead._id,
        assignedTo: employeeId,
        scheduledAt: scheduled,
        reason: remark || "No answer - rescheduled callback",
        status: "SCHEDULED",
        createdBy: employeeId,
        notes: remark || null,
      });
    }
  } else if (outcome === "RESCHEDULED") {
    lead.status = "RESCHEDULED";
    lead.pipelineStage = "RESCHEDULED";
    const scheduled = followUpDate ? new Date(followUpDate) : new Date(Date.now() + 86400000);
    lead.nextFollowUpAt = scheduled;

    followUpRecord = await FollowUp.create({
      leadId: lead._id,
      assignedTo: employeeId,
      scheduledAt: scheduled,
      reason: remark || "Rescheduled callback",
      status: "SCHEDULED",
      createdBy: employeeId,
      notes: remark || null,
    });
  } else if (outcome === "REJECTED" || outcome === "NOT_INTERESTED") {
    lead.status = "REJECTED";
    lead.pipelineStage = "LOST";
    lead.lostAt = new Date();
    lead.nextFollowUpAt = null;
    if (rejectionReason) lead.rejectionReason = rejectionReason;

    // Clear active scheduled follow-ups
    await FollowUp.updateMany(
      { leadId: lead._id, status: "SCHEDULED" },
      { $set: { status: "CANCELLED" } }
    );
  }

  await lead.save();

  // Record call log attempt
  const callLog = await CallLog.create({
    leadId: lead._id,
    userId: employeeId,
    startedAt: new Date(),
    endedAt: new Date(),
    outcome: outcome as any,
    notes: remark || null,
  });

  emitLeadEvent("lead:outcome", { leadId: String(lead._id), outcome, status: lead.status });

  return { lead: lead.toObject(), callLog, followUp: followUpRecord };
}

export async function getFollowUpQueue(organizationId: string, employeeId?: string) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const query: any = { status: "SCHEDULED" };
  if (employeeId) query.assignedTo = employeeId;

  const allFollowUps = await FollowUp.find(query)
    .populate({
      path: "leadId",
      select: "name leadId phone email company location status callOutcome rejectionReason productName nextFollowUpAt notes priority organizationId",
    })
    .populate("assignedTo", "fullName email")
    .sort({ scheduledAt: 1 })
    .lean();

  // Filter out any follow-ups where lead doesn't match org
  const validFollowUps = allFollowUps.filter((f) => f.leadId && String((f.leadId as any).organizationId) === organizationId);

  const overdue = validFollowUps.filter((f) => new Date(f.scheduledAt) < startOfDay);
  const today = validFollowUps.filter((f) => {
    const d = new Date(f.scheduledAt);
    return d >= startOfDay && d <= endOfDay;
  });
  const upcoming = validFollowUps.filter((f) => new Date(f.scheduledAt) > endOfDay);

  // Fetch rescheduled, interested, and rejected leads directly for complete follow-up tab view
  const leadQuery: any = { organizationId };
  if (employeeId) {
    leadQuery.$or = [
      { createdBy: employeeId },
      { assignedTo: employeeId },
    ];
  }

  const [rescheduledLeads, interestedLeads, rejectedLeads] = await Promise.all([
    Lead.find({ ...leadQuery, status: { $in: ["RESCHEDULED", "NO_ANSWER"] } }).sort({ nextFollowUpAt: 1 }).lean(),
    Lead.find({ ...leadQuery, status: { $in: ["INTERESTED", "FOLLOW_UP"] } }).sort({ nextFollowUpAt: 1 }).lean(),
    Lead.find({ ...leadQuery, status: "REJECTED" }).sort({ updatedAt: -1 }).lean(),
  ]);

  return {
    overdue,
    today,
    upcoming,
    rescheduled: rescheduledLeads,
    interested: interestedLeads,
    rejected: rejectedLeads,
  };
}

export async function getLeadTimeline(leadId: string, organizationId: string) {
  const lead = await Lead.findOne(getLeadQuery(leadId, organizationId)).populate("productId", "name code").lean();
  if (!lead) throw new Error("Lead not found");

  const assignments = await LeadAssignment.find({ leadId: lead._id })
    .populate("employeeId", "fullName email")
    .populate("assignedBy", "fullName email")
    .populate("previousEmployeeId", "fullName email")
    .sort({ createdAt: -1 })
    .lean();

  const calls = await CallLog.find({ leadId: lead._id })
    .populate("userId", "fullName email")
    .sort({ createdAt: -1 })
    .lean();

  const followUps = await FollowUp.find({ leadId: lead._id })
    .populate("assignedTo", "fullName email")
    .sort({ createdAt: -1 })
    .lean();

  // Combine into single chronological timeline
  const timeline: any[] = [];

  assignments.forEach((a) => {
    timeline.push({
      type: "ASSIGNMENT",
      timestamp: a.assignedAt || a.createdAt,
      title: `Assigned to ${(a.employeeId as any)?.fullName || "Employee"}`,
      details: `Mode: ${a.assignmentMode}${a.reason ? ` (${a.reason})` : ""}`,
      actor: (a.assignedBy as any)?.fullName || "System",
    });
  });

  calls.forEach((c) => {
    timeline.push({
      type: "CALL",
      timestamp: c.startedAt || c.createdAt,
      title: `Call Attempt: ${c.outcome}`,
      details: c.notes || "No remarks",
      actor: (c.userId as any)?.fullName || "Employee",
    });
  });

  followUps.forEach((f) => {
    timeline.push({
      type: "FOLLOW_UP",
      timestamp: f.scheduledAt,
      title: `Follow-up Scheduled (${f.status})`,
      details: f.reason || f.notes || "Follow-up reminder",
      actor: (f.assignedTo as any)?.fullName || "Employee",
    });
  });

  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { lead, timeline };
}
