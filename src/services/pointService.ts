import { PointTransaction, IPointTransaction, PointSourceType, PointTransactionType } from "../models/PointTransaction";
import { PointRule } from "../models/PointRule";
import { emitPointsUpdated } from "../lib/socketEmitters";
import { ObjectId } from "mongoose";

const DEFAULT_RULE_POINTS: Record<string, number> = {
  TASK_APPROVED: 10,
  TASK_EARLY_COMPLETION: 5,
  TARGET_ACHIEVED: 25,
  DAILY_REPORT_SUBMITTED: 2,
  BONUS: 0,
  PENALTY: 0,
};

export class PointService {
  /**
   * Award points for a specific rule
   */
  static async awardPoints(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    ruleKey: string,
    sourceId?: string | ObjectId,
    createdBy?: string | ObjectId,
    customPoints?: number
  ): Promise<IPointTransaction | null> {
    try {
      const sourceType = this.mapRuleKeyToSourceType(ruleKey);
      if (sourceId) {
        const alreadyAwarded = await this.isPointsAlreadyAwarded(
          userId,
          organizationId,
          sourceType,
          sourceId
        );
        if (alreadyAwarded) {
          return null;
        }
      }

      let pointsToAward = customPoints && customPoints > 0 ? customPoints : 0;

      if (!pointsToAward) {
        const rule = await PointRule.findOne({
          organizationId,
          key: ruleKey,
          active: true,
        });

        if (rule && rule.points > 0) {
          pointsToAward = rule.points;
        } else if (DEFAULT_RULE_POINTS[ruleKey] && DEFAULT_RULE_POINTS[ruleKey] > 0) {
          pointsToAward = DEFAULT_RULE_POINTS[ruleKey];
        }
      }

      if (pointsToAward <= 0) {
        return null;
      }

      return this.createTransaction(
        userId,
        organizationId,
        "EARNED",
        pointsToAward,
        sourceType,
        sourceId,
        ruleKey,
        createdBy
      );
    } catch (error) {
      console.error("Error awarding points:", error);
      throw error;
    }
  }

  /**
   * Create a point transaction (private helper)
   */
  static async createTransaction(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    type: PointTransactionType,
    points: number,
    sourceType: PointSourceType,
    sourceId?: string | ObjectId | null,
    reason?: string,
    createdBy?: string | ObjectId | null
  ): Promise<IPointTransaction> {
    const transaction = new PointTransaction({
      userId,
      organizationId,
      type,
      points,
      sourceType,
      sourceId: sourceId || null,
      reason: reason || `${type} points for ${sourceType}`,
      createdBy: createdBy || null,
    });

    const saved = await transaction.save();

    // Emit Socket.IO event
    try {
      emitPointsUpdated(userId, saved, organizationId);
    } catch (error) {
      console.error("Error emitting points event:", error);
    }

    return saved;
  }

  /**
   * Manually adjust points (admin/super admin only)
   */
  static async adjustPoints(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    points: number,
    reason: string,
    createdBy: string | ObjectId
  ): Promise<IPointTransaction> {
    const type: PointTransactionType = points >= 0 ? "EARNED" : "DEDUCTED";
    const sourceType: PointSourceType = points >= 0 ? "BONUS" : "PENALTY";

    return this.createTransaction(userId, organizationId, type, Math.abs(points), sourceType, null, reason, createdBy);
  }

  /**
   * Get current total points for a user
   */
  static async getCurrentPoints(userId: string | ObjectId, organizationId: string | ObjectId): Promise<number> {
    const result = await PointTransaction.aggregate([
      {
        $match: {
          userId: this.toObjectId(userId),
          organizationId: this.toObjectId(organizationId),
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $eq: ["$type", "EARNED"] }, "$points", { $multiply: ["$points", -1] }],
            },
          },
        },
      },
    ]);

    return result.length > 0 ? Math.max(0, result[0].total) : 0;
  }

  /**
   * Get points for today
   */
  static async getTodayPoints(userId: string | ObjectId, organizationId: string | ObjectId): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.getPointsForDateRange(userId, organizationId, today, new Date());
  }

  /**
   * Get points for this week
   */
  static async getWeeklyPoints(userId: string | ObjectId, organizationId: string | ObjectId): Promise<number> {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);

    return this.getPointsForDateRange(userId, organizationId, weekStart, new Date());
  }

  /**
   * Get points for this month
   */
  static async getMonthlyPoints(userId: string | ObjectId, organizationId: string | ObjectId): Promise<number> {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    return this.getPointsForDateRange(userId, organizationId, monthStart, new Date());
  }

  /**
   * Get points for date range
   */
  static async getPointsForDateRange(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const result = await PointTransaction.aggregate([
      {
        $match: {
          userId: this.toObjectId(userId),
          organizationId: this.toObjectId(organizationId),
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $eq: ["$type", "EARNED"] }, "$points", { $multiply: ["$points", -1] }],
            },
          },
        },
      },
    ]);

    return result.length > 0 ? Math.max(0, result[0].total) : 0;
  }

  /**
   * Get point summary for a user
   */
  static async getPointSummary(userId: string | ObjectId, organizationId: string | ObjectId) {
    const [currentPoints, todayPoints, weeklyPoints, monthlyPoints] = await Promise.all([
      this.getCurrentPoints(userId, organizationId),
      this.getTodayPoints(userId, organizationId),
      this.getWeeklyPoints(userId, organizationId),
      this.getMonthlyPoints(userId, organizationId),
    ]);

    const totalEarned = await this.getTotalEarned(userId, organizationId);
    const totalDeducted = await this.getTotalDeducted(userId, organizationId);

    return {
      currentPoints,
      todayPoints,
      weeklyPoints,
      monthlyPoints,
      lifetimePoints: currentPoints,
      totalEarned,
      totalDeducted,
    };
  }

  /**
   * Get total earned points
   */
  private static async getTotalEarned(userId: string | ObjectId, organizationId: string | ObjectId): Promise<number> {
    const result = await PointTransaction.aggregate([
      {
        $match: {
          userId: this.toObjectId(userId),
          organizationId: this.toObjectId(organizationId),
          type: "EARNED",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$points" },
        },
      },
    ]);

    return result.length > 0 ? result[0].total : 0;
  }

  /**
   * Get total deducted points
   */
  private static async getTotalDeducted(userId: string | ObjectId, organizationId: string | ObjectId): Promise<number> {
    const result = await PointTransaction.aggregate([
      {
        $match: {
          userId: this.toObjectId(userId),
          organizationId: this.toObjectId(organizationId),
          type: "DEDUCTED",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$points" },
        },
      },
    ]);

    return result.length > 0 ? result[0].total : 0;
  }

  /**
   * Check if points already awarded for an event (deduplication)
   */
  static async isPointsAlreadyAwarded(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    sourceType: PointSourceType,
    sourceId: string | ObjectId
  ): Promise<boolean> {
    const count = await PointTransaction.countDocuments({
      userId: this.toObjectId(userId),
      organizationId: this.toObjectId(organizationId),
      sourceType,
      sourceId: this.toObjectId(sourceId),
      type: "EARNED",
    });

    return count > 0;
  }

  /**
   * Map rule key to source type
   */
  private static mapRuleKeyToSourceType(ruleKey: string): PointSourceType {
    if (ruleKey.startsWith("TASK")) {
      return "TASK";
    }
    if (ruleKey.startsWith("TARGET")) {
      return "TARGET";
    }
    if (ruleKey === "DAILY_REPORT_SUBMITTED") {
      return "TASK";
    }
    return "MANUAL";
  }

  /**
   * Helper to convert to ObjectId
   */
  private static toObjectId(value: string | ObjectId): ObjectId {
    if (typeof value === "string") {
      return new (require("mongoose").Types.ObjectId)(value);
    }
    return value;
  }
}
