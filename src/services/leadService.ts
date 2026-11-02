import mongoose from "mongoose";
import Lead, { ILead } from "../models/Lead";
import CallLog from "../models/CallLog";
import FollowUp from "../models/FollowUp";
import LeadImport from "../models/LeadImport";
import LeadAssignment from "../models/LeadAssignment";
import Product from "../models/Product";
import User from "../models/User";
import { IUser } from "../models/User";
import { createNotification } from "./notificationService";

interface AuthContext {
  userId: string;
  role: string;
  organizationId?: string;
  departmentId?: string;
  teamId?: string;
  permissions?: string[];
}

/**
 * Check if user can access leads based on their scope
 */
function canAccessLead(
  user: AuthContext,
  lead: Partial<ILead>,
  requiredPermission?: string
): boolean {
  if (user.role === "SUPER_ADMIN") {
    return true;
  }

  if (user.role === "ADMIN") {
    if (user.organizationId && lead.organizationId && String(lead.organizationId) !== String(user.organizationId)) {
      return false;
    }
    return true;
  }

  // Regular employees can only access leads they created OR are assigned to
  const isCreatedBy = lead.createdBy?.toString() === user.userId;
  const isAssignedTo = lead.assignedTo?.toString() === user.userId;
  const isOrgMatch = !user.organizationId || !lead.organizationId || String(lead.organizationId) === String(user.organizationId);

  return isOrgMatch && (isCreatedBy || isAssignedTo);
}

/**
 * Generate lead ID in NX-LEAD-0001 format
 */
async function generateLeadId(organizationId: string): Promise<string> {
  const lastLead = await Lead.findOne({ organizationId }).sort({ _id: -1 }).lean();

  let nextNumber = 1;
  if (lastLead && lastLead.leadId) {
    const match = lastLead.leadId.match(/NX-LEAD-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `NX-LEAD-${String(nextNumber).padStart(4, "0")}`;
}

/**
 * Check for duplicate leads
 */
async function checkDuplicates(
  organizationId: string,
  phone: string,
  email?: string,
  company?: string
): Promise<ILead | null> {
  const query: any = { organizationId };
  const cleanPhone = phone.trim();

  // Phone is primary key
  const phoneMatch = await Lead.findOne({ ...query, phone: cleanPhone }).lean();
  if (phoneMatch) return phoneMatch;

  // Email is secondary key
  if (email && email.trim()) {
    const emailMatch = await Lead.findOne({ ...query, email: email.trim().toLowerCase() }).lean();
    if (emailMatch) return emailMatch;
  }

  return null;
}

/**
 * Create a lead
 */
export async function createLead(
  user: AuthContext,
  data: {
    name: string;
    phone: string;
    email?: string;
    company?: string;
    location?: string;
    city?: string;
    state?: string;
    source?: string;
    leadType?: string;
    productId?: string;
    productName?: string;
    priority?: string;
    notes?: string;
    departmentId?: string;
    teamId?: string;
    assignedTo?: string;
  }
) {
  // Permission check
  if (!user.permissions?.includes("lead.create") && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN" && user.role !== "MANAGER") {
    throw new Error("FORBIDDEN");
  }

  // Check for duplicates
  const duplicate = await checkDuplicates(user.organizationId!, data.phone, data.email, data.company);
  if (duplicate) {
    throw new Error("LEAD_DUPLICATE");
  }

  // For non-admin roles (EMPLOYEE, SALES_EXECUTIVE, INTERN, MARKETING, DESIGNER, DEVELOPER),
  // the lead is AUTOMATICALLY self-assigned to the creator (user.userId).
  const isManagerOrAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"].includes(user.role);
  let targetAssigneeId = data.assignedTo;
  if (!isManagerOrAdmin) {
    targetAssigneeId = user.userId;
  }

  let assignedUser: any = null;
  if (targetAssigneeId && targetAssigneeId.trim().length > 0) {
    assignedUser = await User.findOne({
      _id: targetAssigneeId,
      organizationId: user.organizationId,
      status: "ACTIVE",
    }).lean();
    if (!assignedUser && isManagerOrAdmin) {
      throw new Error("INVALID_ASSIGNED_USER");
    }
  }

  // Resolve Product if provided
  let resolvedProductId: string | null = data.productId || null;
  let resolvedProductName: string | null = data.productName || null;
  if (resolvedProductId) {
    const productDoc = await Product.findOne({ _id: resolvedProductId, organizationId: user.organizationId }).lean();
    if (productDoc) {
      resolvedProductName = productDoc.name;
    }
  } else if (resolvedProductName) {
    const productDoc = await Product.findOne({
      organizationId: user.organizationId,
      $or: [{ name: new RegExp(resolvedProductName, "i") }, { code: new RegExp(resolvedProductName, "i") }],
    }).lean();
    if (productDoc) {
      resolvedProductId = String(productDoc._id);
      resolvedProductName = productDoc.name;
    }
  }

  const leadId = await generateLeadId(user.organizationId!);

  const lead = await Lead.create({
    leadId,
    organizationId: new mongoose.Types.ObjectId(user.organizationId!),
    departmentId: data.departmentId || null,
    teamId: data.teamId || null,
    productId: resolvedProductId ? new mongoose.Types.ObjectId(resolvedProductId) : null,
    productName: resolvedProductName,
    assignedTo: assignedUser ? assignedUser._id : new mongoose.Types.ObjectId(user.userId),
    assignedAt: new Date(),
    createdBy: new mongoose.Types.ObjectId(user.userId),
    name: data.name,
    phone: data.phone.trim(),
    email: data.email ? data.email.trim().toLowerCase() : null,
    company: data.company || null,
    location: data.location || null,
    city: data.city || null,
    state: data.state || null,
    source: data.source || "MANUAL",
    leadType: data.leadType || null,
    priority: data.priority || "WARM",
    status: "NEW",
    pipelineStage: "NEW",
    notes: data.notes || null,
    callCount: 0,
    uncontacted: true,
  });

  if (assignedUser) {
    await LeadAssignment.create({
      organizationId: user.organizationId,
      leadId: lead._id,
      employeeId: assignedUser._id,
      productId: resolvedProductId ? new mongoose.Types.ObjectId(resolvedProductId) : null,
      assignedBy: user.userId,
      assignmentMode: "MANUAL",
      assignedAt: new Date(),
      reason: "Manual lead creation assignment",
    });
  }

  return lead.toObject();
}

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

/**
 * List leads with scope filtering
 */
export async function listLeads(
  user: AuthContext,
  filters: {
    search?: string;
    status?: string;
    pipelineStage?: string;
    priority?: string;
    assignedTo?: string;
    departmentId?: string;
    teamId?: string;
    source?: string;
    leadType?: string;
    followUpToday?: boolean;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }
) {
  if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    const hasLeadPermission =
      user.permissions &&
      (user.permissions.includes("lead.view.self") ||
        user.permissions.includes("lead.view") ||
        user.permissions.includes("lead.create") ||
        user.permissions.includes("lead.assign") ||
        user.permissions.includes("lead.call") ||
        user.permissions.includes("lead.followup"));
    if (!hasLeadPermission) {
      throw new Error("FORBIDDEN");
    }
  }

  const query: any = {};

  // Apply scope filtering at MongoDB query level
  if (user.role === "SUPER_ADMIN") {
    if (user.organizationId) {
      query.organizationId = new mongoose.Types.ObjectId(user.organizationId);
    }
  } else if (user.role === "ADMIN") {
    query.organizationId = new mongoose.Types.ObjectId(user.organizationId);
    if (user.departmentId) {
      query.departmentId = user.departmentId;
    }
  } else if (user.role === "TEAM_LEADER" || user.role === "MANAGER") {
    query.organizationId = new mongoose.Types.ObjectId(user.organizationId);
    if (user.teamId) {
      query.teamId = user.teamId;
    }
  } else {
    // Regular employees can only see leads they created OR are assigned to
    query.organizationId = new mongoose.Types.ObjectId(user.organizationId);
    query.$or = [
      { createdBy: new mongoose.Types.ObjectId(user.userId) },
      { assignedTo: new mongoose.Types.ObjectId(user.userId) },
    ];
  }

  // Apply filters
  if (filters.search && filters.search.trim()) {
    const searchRegex = { $regex: filters.search.trim(), $options: "i" };
    const searchQuery = [
      { leadId: searchRegex },
      { name: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
      { company: searchRegex },
    ];

    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchQuery }];
      delete query.$or;
    } else {
      query.$or = searchQuery;
    }
  }

  if (filters.status) query.status = filters.status;
  if (filters.pipelineStage) query.pipelineStage = filters.pipelineStage;
  if (filters.priority) query.priority = filters.priority;
  if (filters.assignedTo && (user.role === "SUPER_ADMIN" || user.role === "ADMIN")) {
    query.assignedTo = new mongoose.Types.ObjectId(filters.assignedTo);
  }
  if (filters.departmentId) query.departmentId = filters.departmentId;
  if (filters.teamId) query.teamId = filters.teamId;
  if (filters.source) query.source = filters.source;
  if (filters.leadType) query.leadType = filters.leadType;

  if (filters.followUpToday) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    query.nextFollowUpAt = { $gte: today, $lt: tomorrow };
  }

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 20, 100);
  const skip = (page - 1) * limit;

  const sortBy = filters.sortBy || "createdAt";
  const sortOrder = filters.sortOrder === "asc" ? 1 : -1;
  const sort: any = { [sortBy]: sortOrder };

  const [leads, total] = await Promise.all([
    Lead.find(query)
      .populate("assignedTo", "fullName email")
      .populate("createdBy", "fullName email")
      .populate("productId", "name code")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Lead.countDocuments(query),
  ]);

  return {
    leads,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

/**
 * Get lead by ID
 */
export async function getLead(user: AuthContext, leadId: string) {
  const lead = await Lead.findOne(getLeadQuery(leadId)).lean();
  if (!lead) {
    throw new Error("LEAD_NOT_FOUND");
  }

  if (!canAccessLead(user, lead, "lead.view.self")) {
    throw new Error("FORBIDDEN");
  }

  return lead;
}

/**
 * Update lead
 */
export async function updateLead(
  user: AuthContext,
  leadId: string,
  data: Partial<ILead>
) {
  const lead = await Lead.findOne(getLeadQuery(leadId)).lean();
  if (!lead) {
    throw new Error("LEAD_NOT_FOUND");
  }

  if (!canAccessLead(user, lead)) {
    throw new Error("FORBIDDEN");
  }

  // Strip client-supplied ownership fields for non-admin employees
  if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    delete (data as any).createdBy;
    delete (data as any).assignedTo;
    delete (data as any).organizationId;
  }

  if (data.status === "REJECTED") {
    data.nextFollowUpAt = null as any;
    // Cancel active follow-ups
    await FollowUp.updateMany(
      { leadId: lead._id, status: "SCHEDULED" },
      { $set: { status: "CANCELLED" } }
    );
  }

  const updated = await Lead.findOneAndUpdate(getLeadQuery(leadId), { $set: data }, { new: true });
  return updated?.toObject();
}

/**
 * Assign lead
 */
export async function assignLead(
  user: AuthContext,
  leadId: string,
  assignedToUserId: string
) {
  if (!user.permissions?.includes("lead.assign")) {
    throw new Error("FORBIDDEN");
  }

  const lead = await Lead.findOne(getLeadQuery(leadId)).lean();
  if (!lead) {
    throw new Error("LEAD_NOT_FOUND");
  }

  if (!canAccessLead(user, lead)) {
    throw new Error("FORBIDDEN");
  }

  const assignedUser = await User.findById(assignedToUserId).lean();
  if (!assignedUser || assignedUser.status !== "ACTIVE") {
    throw new Error("INVALID_ASSIGNED_USER");
  }

  const updated = await Lead.findOneAndUpdate(
    getLeadQuery(leadId),
    { assignedTo: new mongoose.Types.ObjectId(assignedToUserId) },
    { new: true }
  );

  return updated?.toObject();
}

/**
 * Log call
 */
export async function logCall(
  user: AuthContext,
  leadId: string,
  data: {
    startedAt: Date;
    endedAt?: Date;
    duration?: number;
    outcome: string;
    notes?: string;
  }
) {
  if (!user.permissions?.includes("lead.call")) {
    throw new Error("FORBIDDEN");
  }

  const lead = await Lead.findOne(getLeadQuery(leadId)).lean();
  if (!lead) {
    throw new Error("LEAD_NOT_FOUND");
  }

  if (!canAccessLead(user, lead)) {
    throw new Error("FORBIDDEN");
  }

  const callLog = await CallLog.create({
    leadId: lead._id,
    userId: new mongoose.Types.ObjectId(user.userId),
    startedAt: data.startedAt,
    endedAt: data.endedAt || null,
    duration: data.duration || null,
    outcome: data.outcome,
    notes: data.notes || null,
  });

  // Update lead lastContactedAt and increment call count
  await Lead.updateOne(
    { _id: lead._id },
    {
      lastContactedAt: new Date(),
      $inc: { callCount: 1 },
    }
  );

  return callLog.toObject();
}

/**
 * Get call history
 */
export async function getCallHistory(user: AuthContext, leadId: string) {
  const lead = await Lead.findOne(getLeadQuery(leadId)).lean();
  if (!lead) {
    throw new Error("LEAD_NOT_FOUND");
  }

  if (!canAccessLead(user, lead, "lead.view.self")) {
    throw new Error("FORBIDDEN");
  }

  const calls = await CallLog.find({ leadId: lead._id })
    .populate("userId", "fullName email")
    .sort({ createdAt: -1 })
    .lean();

  return calls;
}

/**
 * Create follow-up
 */
export async function createFollowUp(
  user: AuthContext,
  leadId: string,
  data: {
    scheduledAt: Date;
    reason?: string;
    notes?: string;
  }
) {
  if (!user.permissions?.includes("lead.followup")) {
    throw new Error("FORBIDDEN");
  }

  const lead = await Lead.findOne(getLeadQuery(leadId)).lean();
  if (!lead) {
    throw new Error("LEAD_NOT_FOUND");
  }

  if (!canAccessLead(user, lead)) {
    throw new Error("FORBIDDEN");
  }

  const followUp = await FollowUp.create({
    leadId: lead._id,
    assignedTo: lead.assignedTo || new mongoose.Types.ObjectId(user.userId),
    scheduledAt: data.scheduledAt,
    reason: data.reason || null,
    createdBy: new mongoose.Types.ObjectId(user.userId),
    notes: data.notes || null,
  });

  // Update lead nextFollowUpAt
  await Lead.updateOne({ _id: lead._id }, { nextFollowUpAt: data.scheduledAt });

  return followUp.toObject();
}

/**
 * Get follow-ups
 */
export async function getFollowUps(
  user: AuthContext,
  filters: {
    status?: string;
    assignedTo?: string;
    today?: boolean;
    overdue?: boolean;
    page?: number;
    limit?: number;
  }
) {
  const query: any = {};

  if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    query.assignedTo = new mongoose.Types.ObjectId(user.userId);
  }

  if (filters.status) query.status = filters.status;
  if (filters.assignedTo) query.assignedTo = new mongoose.Types.ObjectId(filters.assignedTo);

  if (filters.today) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    query.scheduledAt = { $gte: today, $lt: tomorrow };
  }

  if (filters.overdue) {
    const now = new Date();
    query.scheduledAt = { $lt: now };
    query.status = { $in: ["SCHEDULED", "MISSED"] };
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 20, 100);
  const skip = (page - 1) * limit;

  const [followUps, total] = await Promise.all([
    FollowUp.find(query)
      .populate("leadId", "name phone company assignedTo")
      .populate("assignedTo", "fullName email")
      .sort({ scheduledAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FollowUp.countDocuments(query),
  ]);

  return {
    followUps,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

/**
 * Complete follow-up
 */
export async function completeFollowUp(
  user: AuthContext,
  followUpId: string,
  notes?: string
) {
  const followUp = await FollowUp.findById(followUpId).lean();
  if (!followUp) {
    throw new Error("FOLLOWUP_NOT_FOUND");
  }

  // Only assigned user or admin can complete
  if (
    user.userId !== followUp.assignedTo.toString() &&
    user.role !== "ADMIN" &&
    user.role !== "SUPER_ADMIN"
  ) {
    throw new Error("FORBIDDEN");
  }

  const updated = await FollowUp.findByIdAndUpdate(
    followUpId,
    {
      status: "COMPLETED",
      completedAt: new Date(),
      notes: notes || followUp.notes,
    },
    { new: true }
  );

  return updated?.toObject();
}

export default {
  createLead,
  listLeads,
  getLead,
  updateLead,
  assignLead,
  logCall,
  getCallHistory,
  createFollowUp,
  getFollowUps,
  completeFollowUp,
};
