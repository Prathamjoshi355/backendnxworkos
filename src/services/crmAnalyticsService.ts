import Lead from "../models/Lead";
import User from "../models/User";
import Product from "../models/Product";
import LeadQuota from "../models/LeadQuota";
import FollowUp from "../models/FollowUp";
import CallLog from "../models/CallLog";
import LeadImport from "../models/LeadImport";

export async function getCRMDashboardAnalytics(organizationId: string, scopedUserIds?: string[]) {
  const query: any = { organizationId };
  if (scopedUserIds && scopedUserIds.length > 0) {
    query.assignedTo = { $in: scopedUserIds };
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const [
    totalLeads,
    newLeads,
    unassignedLeads,
    assignedLeads,
    hotLeads,
    interestedLeads,
    notInterestedLeads,
    callNotPicked,
    wonLeads,
    lostLeads,
    uncontactedLeads,
    importedToday,
  ] = await Promise.all([
    Lead.countDocuments(query),
    Lead.countDocuments({ ...query, status: "NEW" }),
    Lead.countDocuments({ ...query, assignedTo: null }),
    Lead.countDocuments({ ...query, assignedTo: { $ne: null } }),
    Lead.countDocuments({ ...query, priority: "HOT" }),
    Lead.countDocuments({ ...query, status: "INTERESTED" }),
    Lead.countDocuments({ ...query, status: "NOT_INTERESTED" }),
    Lead.countDocuments({ ...query, callOutcome: "CALL_NOT_PICKED" }),
    Lead.countDocuments({ ...query, status: { $in: ["WON", "CONVERTED"] } }),
    Lead.countDocuments({ ...query, status: "LOST" }),
    Lead.countDocuments({ ...query, uncontacted: true }),
    LeadImport.aggregate([
      { $match: { organizationId, createdAt: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: null, total: { $sum: "$successfulRows" } } },
    ]),
  ]);

  const followUpQuery: any = { status: "SCHEDULED" };
  if (scopedUserIds && scopedUserIds.length > 0) {
    followUpQuery.assignedTo = { $in: scopedUserIds };
  }

  const todaysFollowUps = await FollowUp.countDocuments({
    ...followUpQuery,
    scheduledAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const overdueFollowUps = await FollowUp.countDocuments({
    ...followUpQuery,
    scheduledAt: { $lt: startOfDay },
  });

  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;
  const importedTodayCount = importedToday.length > 0 ? importedToday[0].total : 0;

  // Pipeline breakdown
  const pipeline = [
    { stage: "NEW", count: newLeads },
    { stage: "CONTACTED", count: await Lead.countDocuments({ ...query, status: "CONTACTED" }) },
    { stage: "QUALIFIED", count: await Lead.countDocuments({ ...query, status: "QUALIFIED" }) },
    { stage: "INTERESTED", count: interestedLeads },
    { stage: "NEGOTIATION", count: await Lead.countDocuments({ ...query, status: "NEGOTIATION" }) },
    { stage: "WON", count: wonLeads },
    { stage: "LOST", count: lostLeads },
  ];

  return {
    metrics: {
      totalLeads,
      newLeads,
      unassignedLeads,
      assignedLeads,
      todaysFollowUps,
      overdueFollowUps,
      hotLeads,
      interestedLeads,
      notInterestedLeads,
      callNotPicked,
      wonLeads,
      lostLeads,
      uncontactedLeads,
      conversionRate,
      importedToday: importedTodayCount,
    },
    pipeline,
  };
}

export async function getEmployeePerformance(organizationId: string) {
  const employees = await User.find({ organizationId, role: { $in: ["SALES_EXECUTIVE", "TEAM_LEADER", "MANAGER", "EMPLOYEE"] } })
    .select("fullName email employeeId role")
    .lean();

  const performance = await Promise.all(
    employees.map(async (emp) => {
      const assigned = await Lead.countDocuments({ organizationId, assignedTo: emp._id });
      const called = await Lead.countDocuments({ organizationId, assignedTo: emp._id, callCount: { $gt: 0 } });
      const interested = await Lead.countDocuments({ organizationId, assignedTo: emp._id, status: "INTERESTED" });
      const notInterested = await Lead.countDocuments({ organizationId, assignedTo: emp._id, status: "NOT_INTERESTED" });
      const callNotPicked = await Lead.countDocuments({ organizationId, assignedTo: emp._id, callOutcome: "CALL_NOT_PICKED" });
      const won = await Lead.countDocuments({ organizationId, assignedTo: emp._id, status: { $in: ["WON", "CONVERTED"] } });
      const lost = await Lead.countDocuments({ organizationId, assignedTo: emp._id, status: "LOST" });
      const unworked = await Lead.countDocuments({ organizationId, assignedTo: emp._id, callCount: 0 });

      const followUpsCompleted = await FollowUp.countDocuments({ assignedTo: emp._id, status: "COMPLETED" });
      const followUpsMissed = await FollowUp.countDocuments({ assignedTo: emp._id, status: "SCHEDULED", scheduledAt: { $lt: new Date() } });

      const conversionRate = assigned > 0 ? Math.round((won / assigned) * 100) : 0;

      return {
        employee: emp,
        metrics: {
          assigned,
          called,
          interested,
          notInterested,
          callNotPicked,
          followUpsCompleted,
          followUpsMissed,
          won,
          lost,
          unworked,
          conversionRate,
        },
      };
    })
  );

  return performance;
}

export async function getProductPerformance(organizationId: string) {
  const products = await Product.find({ organizationId }).sort({ name: 1 }).lean();

  const productPerformance = await Promise.all(
    products.map(async (prod) => {
      const totalLeads = await Lead.countDocuments({ organizationId, productId: prod._id });
      const called = await Lead.countDocuments({ organizationId, productId: prod._id, callCount: { $gt: 0 } });
      const interested = await Lead.countDocuments({ organizationId, productId: prod._id, status: "INTERESTED" });
      const negotiation = await Lead.countDocuments({ organizationId, productId: prod._id, status: "NEGOTIATION" });
      const won = await Lead.countDocuments({ organizationId, productId: prod._id, status: { $in: ["WON", "CONVERTED"] } });
      const lost = await Lead.countDocuments({ organizationId, productId: prod._id, status: "LOST" });

      const conversionRate = totalLeads > 0 ? Math.round((won / totalLeads) * 100) : 0;

      return {
        product: prod,
        metrics: {
          totalLeads,
          called,
          interested,
          negotiation,
          won,
          lost,
          conversionRate,
        },
      };
    })
  );

  return productPerformance;
}
