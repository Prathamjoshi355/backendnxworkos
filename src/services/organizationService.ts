import Organization from "../models/Organization";
import { PointRule } from "../models/PointRule";

const DEFAULT_POINT_RULES = [
  { key: "TASK_APPROVED", points: 10, description: "Points awarded when a task is approved" },
  { key: "TASK_EARLY_COMPLETION", points: 5, description: "Bonus points for early task completion" },
  { key: "TARGET_ACHIEVED", points: 25, description: "Points awarded when a target is achieved" },
  { key: "DAILY_REPORT_SUBMITTED", points: 2, description: "Points for submitting daily report" },
  { key: "BONUS", points: 0, description: "Manual bonus points" },
  { key: "PENALTY", points: 0, description: "Manual penalty points" },
];

export async function createOrganization(payload: any) {
  const created = await Organization.create(payload);
  const orgObject = created.toObject();

  // Create default point rules
  try {
    const rules = DEFAULT_POINT_RULES.map((rule) => ({
      ...rule,
      organizationId: orgObject._id,
      active: true,
    }));
    await PointRule.insertMany(rules);
  } catch (error) {
    console.error("Error creating default point rules:", error);
    // Don't fail organization creation if rules fail
  }

  return orgObject;
}

export async function getOrganizationById(id: string) {
  return Organization.findById(id).lean();
}

export async function listOrganizations(filter: any = {}, opts: any = {}) {
  const { skip = 0, limit = 20 } = opts;
  const query = Organization.find(filter).skip(skip).limit(limit).lean();
  const items = await query.exec();
  const total = await Organization.countDocuments(filter);
  return { items, total };
}

export async function updateOrganization(id: string, payload: any) {
  const updated = await Organization.findByIdAndUpdate(id, payload, { new: true }).lean();
  return updated;
}

export async function setOrganizationStatus(id: string, status: string) {
  const updated = await Organization.findByIdAndUpdate(id, { status }, { new: true }).lean();
  return updated;
}
