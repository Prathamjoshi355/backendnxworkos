import Product, { IProduct } from "../models/Product";
import Lead from "../models/Lead";

export async function createProduct(payload: {
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  status?: "ACTIVE" | "INACTIVE";
}) {
  const count = await Product.countDocuments({ organizationId: payload.organizationId });
  const productId = `PROD-${String(count + 1).padStart(3, "0")}`;

  const created = await Product.create({
    productId,
    organizationId: payload.organizationId,
    name: payload.name.trim(),
    code: payload.code.trim().toUpperCase(),
    description: payload.description || null,
    status: payload.status || "ACTIVE",
  });
  return created.toObject();
}

export async function listProducts(organizationId: string) {
  const products = await Product.find({ organizationId }).sort({ name: 1 }).lean();
  
  // Aggregate stats per product
  const productStats = await Promise.all(
    products.map(async (prod) => {
      const totalLeads = await Lead.countDocuments({ organizationId, productId: prod._id });
      const assignedLeads = await Lead.countDocuments({ organizationId, productId: prod._id, assignedTo: { $ne: null } });
      const unassignedLeads = totalLeads - assignedLeads;
      const contacted = await Lead.countDocuments({ organizationId, productId: prod._id, status: { $ne: "NEW" } });
      const interested = await Lead.countDocuments({ organizationId, productId: prod._id, status: "INTERESTED" });
      const notInterested = await Lead.countDocuments({ organizationId, productId: prod._id, status: "NOT_INTERESTED" });
      const callNotPicked = await Lead.countDocuments({ organizationId, productId: prod._id, callOutcome: "CALL_NOT_PICKED" });
      const followUps = await Lead.countDocuments({ organizationId, productId: prod._id, status: "FOLLOW_UP" });
      const won = await Lead.countDocuments({ organizationId, productId: prod._id, status: { $in: ["WON", "CONVERTED"] } });
      const lost = await Lead.countDocuments({ organizationId, productId: prod._id, status: "LOST" });
      const conversionRate = totalLeads > 0 ? Math.round((won / totalLeads) * 100) : 0;

      return {
        ...prod,
        stats: {
          totalLeads,
          assignedLeads,
          unassignedLeads,
          contacted,
          interested,
          notInterested,
          callNotPicked,
          followUps,
          won,
          lost,
          conversionRate,
        },
      };
    })
  );

  return productStats;
}

export async function updateProduct(id: string, organizationId: string, updates: Partial<IProduct>) {
  const updated = await Product.findOneAndUpdate(
    { _id: id, organizationId },
    { $set: updates },
    { new: true }
  ).lean();
  return updated;
}
