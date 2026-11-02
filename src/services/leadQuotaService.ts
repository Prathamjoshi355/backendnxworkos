import LeadQuota, { ILeadQuota } from "../models/LeadQuota";
import User from "../models/User";
import Product from "../models/Product";
import Lead from "../models/Lead";

export async function createQuotaRule(payload: {
  organizationId: string;
  productId: string;
  employeeId: string;
  maxLeads: number;
  period?: "MONTHLY" | "WEEKLY" | "ALL_TIME";
  departmentId?: string;
  teamId?: string;
}) {
  const [targetEmployee, targetProduct] = await Promise.all([
    User.findOne({ _id: payload.employeeId, organizationId: payload.organizationId }).lean(),
    Product.findOne({ _id: payload.productId, organizationId: payload.organizationId }).lean(),
  ]);

  if (!targetEmployee) {
    throw new Error("Target employee not found or belongs to another organization.");
  }
  if (!targetProduct) {
    throw new Error("Target product not found or belongs to another organization.");
  }

  const existing = await LeadQuota.findOne({
    organizationId: payload.organizationId,
    productId: payload.productId,
    employeeId: payload.employeeId,
  });

  if (existing) {
    existing.maxLeads = payload.maxLeads;
    existing.period = payload.period || existing.period;
    existing.status = "ACTIVE";
    await existing.save();
    return existing.toObject();
  }

  const created = await LeadQuota.create({
    organizationId: payload.organizationId,
    productId: payload.productId,
    employeeId: payload.employeeId,
    maxLeads: payload.maxLeads,
    assignedCount: 0,
    period: payload.period || "MONTHLY",
    departmentId: payload.departmentId || null,
    teamId: payload.teamId || null,
    status: "ACTIVE",
  });
  return created.toObject();
}

export async function listQuotaRules(organizationId: string) {
  const quotas = await LeadQuota.find({ organizationId })
    .populate("productId", "name code")
    .populate("employeeId", "fullName email employeeId")
    .sort({ createdAt: -1 })
    .lean();

  // Dynamically recalculate actual assigned lead count per employee/product
  const enrichedQuotas = await Promise.all(
    quotas.map(async (q) => {
      const assignedCount = await Lead.countDocuments({
        organizationId,
        productId: q.productId?._id || q.productId,
        assignedTo: q.employeeId?._id || q.employeeId,
      });

      const remaining = Math.max(0, q.maxLeads - assignedCount);
      const progressPercent = q.maxLeads > 0 ? Math.min(100, Math.round((assignedCount / q.maxLeads) * 100)) : 0;

      return {
        ...q,
        assignedCount,
        remaining,
        progressPercent,
      };
    })
  );

  return enrichedQuotas;
}

export async function updateQuotaRule(id: string, organizationId: string, updates: Partial<ILeadQuota>) {
  const updated = await LeadQuota.findOneAndUpdate(
    { _id: id, organizationId },
    { $set: updates },
    { new: true }
  ).lean();
  return updated;
}

export async function deleteQuotaRule(id: string, organizationId: string) {
  await LeadQuota.deleteOne({ _id: id, organizationId });
  return true;
}
